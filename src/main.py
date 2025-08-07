"""
Cloudflare Workers Python script for Garmin Connect data synchronization
Runs daily or on webhook trigger to sync workout data to database
"""

import json
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import garth
from garth.exc import GarthException
from workers import Request, Response, Environment, CronEvent

# Configuration
GARMIN_BASE_URL = 'https://connect.garmin.com'
PAGE_SIZE = 20

# Database table names
ACTIVITIES_TABLE = 'activities'
EXERCISE_SETS_TABLE = 'exercise_sets'

class GarminSyncWorker:
    """Main worker class for Garmin data synchronization"""
    
    def __init__(self):
        self.garmin_session = None
    
    async def on_fetch(self, request: Request, env: Environment) -> Response:
        """Handle HTTP requests (webhook endpoint)"""
        url = request.url
        method = request.method
        
        # Webhook endpoint for manual triggers - FAST RESPONSE (< 1 second)
        if url.endswith('/sync') and method == 'POST':
            # Verify webhook signature if needed
            signature = request.headers.get('X-Webhook-Signature')
            if not self.verify_webhook_signature(request, signature, env):
                return Response('Unauthorized', status=401)
            
            print('Webhook received - triggering background sync...')
            
            # Start sync in background without waiting
            asyncio.create_task(self.sync_garmin_data(env))
            
            # Respond immediately (< 1 second as required)
            return Response(json.dumps({
                'status': 'accepted',
                'message': 'Sync triggered in background',
                'timestamp': datetime.now().isoformat()
            }), headers={'Content-Type': 'application/json'})

        # Ride with GPS webhook endpoint
        if url.endswith('/ridewithgps-webhook') and method == 'POST':
            signature = request.headers.get('X-RideWithGPS-Signature')
            if not self.verify_ridewithgps_signature(request, signature, env):
                return Response('Unauthorized', status=401)

            print('Ride with GPS webhook received - processing in background...')
            asyncio.create_task(self.process_ridewithgps_webhook(request, env))
            return Response('OK')

        # Health check endpoint
        if url.endswith('/health'):
            return Response('OK')

        # Status endpoint to check last sync
        if url.endswith('/status'):
            last_sync = await env.GARMIN_SYNC_KV.get('lastSyncTime')
            return Response(json.dumps({
                'lastSync': last_sync or 'Never',
                'timestamp': datetime.now().isoformat()
            }), headers={'Content-Type': 'application/json'})
        
        return Response('Not Found', status=404)

    async def on_scheduled(self, event: CronEvent, env: Environment):
        """Handle scheduled execution (daily sync)"""
        print('Running scheduled Garmin sync...')
        return await self.sync_garmin_data(env)

    def verify_webhook_signature(self, request: Request, signature: str, env: Environment) -> bool:
        """Verify webhook signature"""
        webhook_secret = env.GARMIN_WEBHOOK_SECRET
        return signature == webhook_secret or not webhook_secret

    def verify_ridewithgps_signature(self, request: Request, signature: str, env: Environment) -> bool:
        """Verify Ride with GPS webhook signature"""
        api_secret = env.RIDEWITHGPS_API_SECRET
        return bool(signature and api_secret)  # Simplified - implement proper HMAC verification

    async def process_ridewithgps_webhook(self, request: Request, env: Environment):
        """Process Ride with GPS webhook data"""
        try:
            webhook_data = await request.json()
            print('Processing Ride with GPS webhook:', webhook_data)
            
            # Process the webhook data (e.g., trigger sync when new activity is uploaded)
            if webhook_data.get('type') in ['activity_created', 'activity_updated']:
                await self.sync_garmin_data(env)
            
            return True
        except Exception as error:
            print('Error processing Ride with GPS webhook:', error)
            raise error

    async def sync_garmin_data(self, env: Environment) -> Dict[str, Any]:
        """Main sync function"""
        try:
            # Authenticate with Garmin using garth
            if not await self.authenticate_garmin(env):
                raise Exception('Failed to authenticate with Garmin')

            # Get last sync timestamp from database
            last_sync_time = await env.GARMIN_SYNC_KV.get('lastSyncTime')
            is_initial_sync = not last_sync_time
            
            print(f"Last sync: {last_sync_time or 'Never'}, Initial sync: {is_initial_sync}")

            # Fetch activities since last sync
            activities = await self.fetch_activities(last_sync_time, is_initial_sync)
            print(f"Fetched {len(activities)} activities")

            # Process and store activities
            processed_count = await self.process_and_store_activities(activities, env)
            
            # Update last sync time
            await env.GARMIN_SYNC_KV.put('lastSyncTime', datetime.now().isoformat())

            return {
                'success': True,
                'activitiesProcessed': processed_count,
                'isInitialSync': is_initial_sync,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as error:
            print('Sync error:', error)
            return {
                'success': False,
                'error': str(error),
                'timestamp': datetime.now().isoformat()
            }

    async def authenticate_garmin(self, env: Environment) -> bool:
        """Authenticate with Garmin Connect using garth library"""
        try:
            username = env.GARMIN_USERNAME
            password = env.GARMIN_PASSWORD
            
            if not username or not password:
                raise Exception('Garmin credentials not provided')

            print('Starting Garmin authentication with garth...')

            # Try to resume existing session first
            try:
                # Check if we have a saved session in KV storage
                saved_session = await env.GARMIN_SYNC_KV.get('garth_session')
                if saved_session:
                    garth.resume_data(json.loads(saved_session))
                    # Test if session is still valid
                    try:
                        garth.client.username  # This will raise GarthException if session expired
                        print('Resumed existing Garmin session')
                        return True
                    except GarthException:
                        print('Saved session expired, logging in again...')
                        pass
            except Exception as e:
                print(f'Could not resume session: {e}')

            # Fresh login if no valid session
            print('Performing fresh Garmin login...')
            garth.login(username, password)
            
            # Save the session for future use
            session_data = garth.dump()
            await env.GARMIN_SYNC_KV.put('garth_session', json.dumps(session_data))
            
            print('Garmin authentication successful')
            return True
            
        except GarthException as error:
            print(f'Garmin authentication failed: {error}')
            return False
        except Exception as error:
            print(f'Garmin authentication error: {error}')
            return False

    async def fetch_activities(self, last_sync_time: Optional[str], is_initial_sync: bool) -> List[Dict]:
        """Fetch activities from Garmin Connect using garth"""
        all_activities = []
        start = 0
        max_activities = 1500 if is_initial_sync else 100  # Limit for initial sync
        
        while len(all_activities) < max_activities:
            try:
                # Use garth's connectapi method to fetch activities
                activities_response = garth.connectapi(
                    f"/activitylist-service/activities/search/activities",
                    params={
                        'limit': PAGE_SIZE,
                        'start': start
                    }
                )
                
                if not activities_response or len(activities_response) == 0:
                    break
                    
                # Filter activities by date if not initial sync
                filtered_activities = activities_response
                if last_sync_time and not is_initial_sync:
                    last_sync_date = datetime.fromisoformat(last_sync_time.replace('Z', '+00:00'))
                    filtered_activities = [
                        activity for activity in activities_response
                        if datetime.fromisoformat(activity['startTimeLocal'].replace('Z', '+00:00')) > last_sync_date
                    ]
                
                all_activities.extend(filtered_activities)
                
                # If we got filtered results and they're from before our sync time, we can stop
                if len(filtered_activities) < len(activities_response):
                    break
                
                start += PAGE_SIZE
                
                # Prevent infinite loops
                if len(activities_response) < PAGE_SIZE:
                    break
                
                # Rate limiting
                await asyncio.sleep(0.1)
                
            except Exception as error:
                print(f'Error fetching activities at start={start}: {error}')
                break
        
        return all_activities

    async def process_and_store_activities(self, activities: List[Dict], env: Environment) -> int:
        """Process and store activities in database"""
        processed_count = 0
        
        for activity in activities:
            try:
                activity_id = activity['activityId']
                
                # Check if activity already exists
                existing = await self.get_activity_by_id(activity_id, env)
                if existing and not self.should_update_activity(existing, activity):
                    continue
                
                # Enrich strength training activities with exercise sets
                if activity.get('activityType', {}).get('typeKey') == 'strength_training':
                    activity['fullExerciseSets'] = await self.fetch_activity_exercise_sets(activity_id)
                
                # Process activity data
                processed_activity = self.process_activity_data(activity)
                
                # Store in database
                await self.store_activity(processed_activity, env)
                processed_count += 1
                
                # Rate limiting
                await asyncio.sleep(0.05)
                
            except Exception as error:
                print(f"Failed to process activity {activity.get('activityId')}: {error}")
        
        return processed_count

    async def fetch_activity_exercise_sets(self, activity_id: int) -> List[Dict]:
        """Fetch exercise sets for a strength training activity using garth"""
        try:
            exercise_sets = garth.connectapi(f"/activity-service/activity/{activity_id}/exerciseSets")
            return exercise_sets.get('exerciseSets', []) if exercise_sets else []
        except Exception as error:
            print(f"Error fetching exercise sets for {activity_id}: {error}")
            return []

    def process_activity_data(self, activity: Dict) -> Dict:
        """Process activity data based on type"""
        base_activity = {
            'id': activity['activityId'],
            'name': activity.get('activityName', ''),
            'type': activity.get('activityType', {}).get('typeKey', 'unknown'),
            'startTime': activity.get('startTimeLocal'),
            'duration': activity.get('duration'),
            'movingTime': activity.get('movingDuration'),
            'calories': activity.get('calories'),
            'averageHR': activity.get('averageHR'),
            'maxHR': activity.get('maxHR'),
            'distance': activity.get('distance'),
            'averageSpeed': activity.get('averageSpeed'),
            'maxSpeed': activity.get('maxSpeed'),
            'elevationGain': activity.get('elevationGain'),
            'elevationLoss': activity.get('elevationLoss'),
            'createdAt': datetime.now().isoformat(),
            'updatedAt': datetime.now().isoformat()
        }
        
        # Process strength training activities
        if activity.get('activityType', {}).get('typeKey') == 'strength_training' and activity.get('fullExerciseSets'):
            base_activity['exerciseSets'] = self.process_exercise_sets(activity['fullExerciseSets'])
            base_activity['totalReps'] = activity.get('totalReps')
            base_activity['totalSets'] = activity.get('totalSets')
        
        # Process cycling/running activities
        activity_type = activity.get('activityType', {}).get('typeKey', '')
        if activity_type in ['cycling', 'running', 'walking']:
            base_activity.update({
                'averagePower': activity.get('avgPower'),
                'maxPower': activity.get('maxPower'),
                'normalizedPower': activity.get('normalizedPower'),
                'trainingStressScore': activity.get('trainingStressScore'),
                'averageCadence': activity.get('avgRunCadence') or activity.get('avgBikeCadence'),
                'maxCadence': activity.get('maxRunCadence') or activity.get('maxBikeCadence')
            })
        
        return base_activity

    def process_exercise_sets(self, exercise_sets: List[Dict]) -> List[Dict]:
        """Process exercise sets data"""
        processed_sets = []
        
        for exercise_set in exercise_sets:
            sets = []
            
            if exercise_set.get('sets') and isinstance(exercise_set['sets'], list):
                for set_data in exercise_set['sets']:
                    sets.append({
                        'reps': set_data.get('repetitionCount', 0),
                        'weight': round(set_data['weight'] / 1000, 2) if set_data.get('weight') else None,  # Convert grams to kg
                        'duration': set_data.get('duration'),
                        'restTime': set_data.get('restTime')
                    })
            
            processed_set = {
                'exerciseName': exercise_set.get('exerciseName', ''),
                'category': exercise_set.get('category', ''),
                'sets': sets,
                'totalReps': sum(s.get('reps', 0) for s in sets),
                'totalVolume': sum((s.get('reps', 0) * (s.get('weight', 0) or 0)) for s in sets)
            }
            processed_sets.append(processed_set)
        
        return processed_sets

    async def get_activity_by_id(self, activity_id: int, env: Environment) -> Optional[Dict]:
        """Check if activity exists in database"""
        try:
            query = f"SELECT id FROM {ACTIVITIES_TABLE} WHERE id = ?"
            result = await env.DATABASE.prepare(query).bind(activity_id).first()
            return result
        except Exception:
            return None

    def should_update_activity(self, existing: Dict, new_activity: Dict) -> bool:
        """Determine if activity should be updated"""
        return False  # For now, don't update existing activities

    async def store_activity(self, activity: Dict, env: Environment):
        """Store activity in database"""
        try:
            # Store main activity data
            activity_query = f"""
                INSERT OR REPLACE INTO {ACTIVITIES_TABLE} 
                (id, name, type, start_time, duration, moving_time, calories, 
                 average_hr, max_hr, distance, average_speed, max_speed, 
                 elevation_gain, elevation_loss, average_power, max_power,
                 normalized_power, training_stress_score, average_cadence, max_cadence,
                 total_reps, total_sets, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            
            await env.DATABASE.prepare(activity_query).bind(
                activity['id'], activity['name'], activity['type'], activity['startTime'],
                activity['duration'], activity['movingTime'], activity['calories'],
                activity['averageHR'], activity['maxHR'], activity['distance'],
                activity['averageSpeed'], activity['maxSpeed'], activity['elevationGain'],
                activity['elevationLoss'], activity['averagePower'], activity['maxPower'],
                activity['normalizedPower'], activity['trainingStressScore'],
                activity['averageCadence'], activity['maxCadence'], activity['totalReps'],
                activity['totalSets'], activity['createdAt'], activity['updatedAt']
            ).run()
            
            # Store exercise sets for strength training
            if activity.get('exerciseSets'):
                # First, delete existing exercise sets for this activity
                await env.DATABASE.prepare(f"DELETE FROM {EXERCISE_SETS_TABLE} WHERE activity_id = ?").bind(activity['id']).run()
                
                # Insert new exercise sets
                for exercise in activity['exerciseSets']:
                    for i, set_data in enumerate(exercise['sets']):
                        set_query = f"""
                            INSERT INTO {EXERCISE_SETS_TABLE}
                            (activity_id, exercise_name, category, set_number, reps, weight, duration, rest_time, total_volume)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """
                        
                        await env.DATABASE.prepare(set_query).bind(
                            activity['id'], exercise['exerciseName'], exercise['category'],
                            i + 1, set_data['reps'], set_data['weight'], set_data['duration'], 
                            set_data['restTime'], set_data['reps'] * (set_data['weight'] or 0)
                        ).run()
                        
        except Exception as error:
            print(f"Error storing activity {activity['id']}: {error}")
            raise


# Create worker instance
worker = GarminSyncWorker()

# Export the handler functions
async def on_fetch(request: Request, env: Environment) -> Response:
    return await worker.on_fetch(request, env)

async def on_scheduled(event: CronEvent, env: Environment):
    return await worker.on_scheduled(event, env)
