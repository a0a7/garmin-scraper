/**
 * Cloudflare Workers script for Garmin Connect data synchronization
 * Runs daily or on webhook trigger to sync workout data to database
 */

// Configuration
const GARMIN_BASE_URL = 'https://connect.garmin.com';
const GARMIN_SSO_URL = 'https://sso.garmin.com';
const PAGE_SIZE = 20;

// Database table names (adjust based on your database schema)
const ACTIVITIES_TABLE = 'activities';
const EXERCISE_SETS_TABLE = 'exercise_sets';

// ES Module exports for scheduled and fetch events
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  },

  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

/**
 * Handle scheduled execution (daily sync)
 */
async function handleScheduled(event, env) {
  console.log('Running scheduled Garmin sync...');
  return await syncGarminData(env);
}

/**
 * Handle HTTP requests (webhook endpoint)
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  
  // Webhook endpoint for manual triggers - FAST RESPONSE (< 1 second)
  if (url.pathname === '/sync' && request.method === 'POST') {
    // Verify webhook signature if needed
    const signature = request.headers.get('X-Webhook-Signature');
    if (!verifyWebhookSignature(request, signature, env)) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    console.log('Webhook received - triggering background sync...');
    
    // Start sync in background without waiting (follows Ride with GPS guideline)
    ctx.waitUntil(syncGarminData(env).catch(error => {
      console.error('Background sync failed:', error);
    }));
    
    // Respond immediately (< 1 second as required)
    return new Response(JSON.stringify({
      status: 'accepted',
      message: 'Sync triggered in background',
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Ride with GPS webhook endpoint
  if (url.pathname === '/ridewithgps-webhook' && request.method === 'POST') {
    const signature = request.headers.get('X-RideWithGPS-Signature');
    if (!verifyRideWithGPSSignature(request, signature, env)) {
      return new Response('Unauthorized', { status: 401 });
    }

    console.log('Ride with GPS webhook received - processing in background...');
    
    // Process webhook data in background
    ctx.waitUntil(processRideWithGPSWebhook(request, env).catch(error => {
      console.error('Ride with GPS webhook processing failed:', error);
    }));

    // Fast response as required
    return new Response('OK', { status: 200 });
  }

  // Ride with GPS OAuth authentication page
  if (url.pathname === '/auth/ridewithgps' && request.method === 'GET') {
    return handleRideWithGPSAuth(request, env);
  }

  // Ride with GPS OAuth callback
  if (url.pathname === '/auth/ridewithgps/callback' && request.method === 'GET') {
    return handleRideWithGPSCallback(request, env);
  }
  
  // Health check endpoint
  if (url.pathname === '/health') {
    return new Response('OK', { status: 200 });
  }

  // Status endpoint to check last sync
  if (url.pathname === '/status') {
    const lastSync = await getLastSyncTime(env);
    return new Response(JSON.stringify({
      lastSync: lastSync || 'Never',
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Not Found', { status: 404 });
}

/**
 * Verify webhook signature (implement based on your webhook provider)
 */
function verifyWebhookSignature(request, signature, env) {
  // Implement signature verification if using webhooks with authentication
  // For now, check if webhook secret matches
  const webhookSecret = env.GARMIN_WEBHOOK_SECRET;
  return signature === webhookSecret || !webhookSecret;
}

/**
 * Verify Ride with GPS webhook signature
 */
function verifyRideWithGPSSignature(request, signature, env) {
  // Implement Ride with GPS signature verification
  // This would typically involve HMAC verification with your API secret
  const apiSecret = env.RIDEWITHGPS_API_SECRET;
  return signature && apiSecret; // Simplified - implement proper HMAC verification
}

/**
 * Process Ride with GPS webhook data
 */
async function processRideWithGPSWebhook(request, env) {
  try {
    const webhookData = await request.json();
    console.log('Processing Ride with GPS webhook:', webhookData);
    
    // Process the webhook data (e.g., trigger sync when new activity is uploaded)
    if (webhookData.type === 'activity_created' || webhookData.type === 'activity_updated') {
      await syncGarminData(env);
    }
    
    return true;
  } catch (error) {
    console.error('Error processing Ride with GPS webhook:', error);
    throw error;
  }
}

/**
 * Handle Ride with GPS OAuth authentication
 */
async function handleRideWithGPSAuth(request, env) {
  const apiKey = env.RIDEWITHGPS_API_KEY;
  const baseUrl = new URL(request.url).origin;
  const redirectUri = `${baseUrl}/auth/ridewithgps/callback`;
  
  // Ride with GPS OAuth URL
  const authUrl = new URL('https://ridewithgps.com/oauth/authorize');
  authUrl.searchParams.set('client_id', apiKey);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'read');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Ride with GPS Authentication</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .container { text-align: center; }
            .btn { display: inline-block; background: #007cba; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 10px; }
            .btn:hover { background: #005a87; }
            .info { background: #f0f8ff; padding: 15px; border-radius: 4px; margin: 20px 0; text-align: left; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚴‍♂️ Ride with GPS Integration</h1>
            <p>Connect your Ride with GPS account to enable webhook notifications for new activities.</p>
            
            <div class="info">
                <h3>What this does:</h3>
                <ul>
                    <li>Allows Ride with GPS to send webhook notifications</li>
                    <li>Triggers automatic Garmin sync when you upload new activities</li>
                    <li>Keeps your activity database up-to-date in real-time</li>
                </ul>
            </div>

            <a href="${authUrl.toString()}" class="btn">Authorize Ride with GPS</a>
            
            <p><small>You'll be redirected to Ride with GPS to authorize this application.</small></p>
            
            <div style="margin-top: 40px;">
                <h3>Webhook Setup</h3>
                <p>After authentication, configure your webhook URL in Ride with GPS:</p>
                <code>${baseUrl}/ridewithgps-webhook</code>
            </div>
        </div>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

/**
 * Handle Ride with GPS OAuth callback
 */
async function handleRideWithGPSCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(`
      <html><body>
        <h1>Authentication Error</h1>
        <p>Error: ${error}</p>
        <a href="/auth/ridewithgps">Try again</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://ridewithgps.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.RIDEWITHGPS_API_KEY,
        client_secret: env.RIDEWITHGPS_API_SECRET,
        code: code,
        redirect_uri: `${new URL(request.url).origin}/auth/ridewithgps/callback`
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.access_token) {
      // Store the access token in KV
      await env.GARMIN_SYNC_KV.put('ridewithgps_access_token', tokenData.access_token);
      
      // Get user info
      const userResponse = await fetch('https://ridewithgps.com/users/current.json', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`
        }
      });
      const userData = await userResponse.json();

      return new Response(`
        <html><body>
          <h1>✅ Authentication Successful</h1>
          <p>Connected to Ride with GPS account: ${userData.user?.name || 'Unknown'}</p>
          <div style="background: #f0f8ff; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <h3>Next Steps:</h3>
            <ol>
              <li>Set up webhook in Ride with GPS dashboard</li>
              <li>Use this URL: <code>${new URL(request.url).origin}/ridewithgps-webhook</code></li>
              <li>Select events: Activity Created, Activity Updated</li>
            </ol>
          </div>
          <p><a href="/status">Check sync status</a></p>
        </body></html>
      `, { headers: { 'Content-Type': 'text/html' } });
    } else {
      throw new Error('Failed to get access token');
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
    return new Response(`
      <html><body>
        <h1>Authentication Failed</h1>
        <p>Error: ${error.message}</p>
        <a href="/auth/ridewithgps">Try again</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }
}

/**
 * Main sync function
 */
async function syncGarminData(env) {
  try {
    // Authenticate with Garmin
    const authHeader = await authenticateGarmin(env);
    if (!authHeader) {
      throw new Error('Failed to authenticate with Garmin');
    }

    // Get last sync timestamp from database
    const lastSyncTime = await getLastSyncTime(env);
    const isInitialSync = !lastSyncTime;
    
    console.log(`Last sync: ${lastSyncTime || 'Never'}, Initial sync: ${isInitialSync}`);

    // Fetch activities since last sync
    const activities = await fetchActivities(authHeader, lastSyncTime, isInitialSync);
    console.log(`Fetched ${activities.length} activities`);

    // Process and store activities
    const processedCount = await processAndStoreActivities(activities, authHeader, env);
    
    // Update last sync time
    await updateLastSyncTime(env);

    return {
      success: true,
      activitiesProcessed: processedCount,
      isInitialSync,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Sync error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Authenticate with Garmin Connect
 */
async function authenticateGarmin(env) {
  try {
    const username = env.GARMIN_USERNAME;
    const password = env.GARMIN_PASSWORD;
    
    if (!username || !password) {
      throw new Error('Garmin credentials not provided');
    }

    // Step 1: Get login form
    const loginPageResponse = await fetch(`${GARMIN_SSO_URL}/signin`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const loginPage = await loginPageResponse.text();
    const csrfMatch = loginPage.match(/name="_csrf"\s+value="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    // Step 2: Submit login credentials
    const loginData = new FormData();
    loginData.append('username', username);
    loginData.append('password', password);
    loginData.append('_csrf', csrfToken);

    const loginResponse = await fetch(`${GARMIN_SSO_URL}/signin`, {
      method: 'POST',
      body: loginData,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${GARMIN_SSO_URL}/signin`
      },
      redirect: 'manual'
    });

    // Step 3: Follow redirects to get session cookies
    let response = loginResponse;
    let redirectCount = 0;
    const maxRedirects = 5;
    
    while (response.status >= 300 && response.status < 400 && redirectCount < maxRedirects) {
      const location = response.headers.get('location');
      if (!location) break;
      
      response = await fetch(location, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        redirect: 'manual'
      });
      redirectCount++;
    }

    // Step 4: Make a request to get auth token
    const activitiesResponse = await fetch(`${GARMIN_BASE_URL}/activitylist-service/activities/search/activities?limit=1&start=0`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    // Extract auth header from request headers (this is a simplified approach)
    // In practice, you'd need to extract the Bearer token from the authentication flow
    const authHeader = response.headers.get('authorization') || 
                      `Bearer ${await getBearerTokenFromResponse(activitiesResponse)}`;
    
    return authHeader;
    
  } catch (error) {
    console.error('Authentication failed:', error);
    return null;
  }
}

/**
 * Extract bearer token from response (implement based on Garmin's actual auth flow)
 */
async function getBearerTokenFromResponse(response) {
  // This is a placeholder - you'll need to implement the actual token extraction
  // based on how Garmin's authentication works in your browser extension
  return 'placeholder-token';
}

/**
 * Fetch activities from Garmin Connect
 */
async function fetchActivities(authHeader, lastSyncTime, isInitialSync) {
  const allActivities = [];
  let start = 0;
  let hasMore = true;
  const maxActivities = isInitialSync ? 1500 : 100; // Limit for initial sync
  
  while (hasMore && allActivities.length < maxActivities) {
    const url = `${GARMIN_BASE_URL}/activitylist-service/activities/search/activities?limit=${PAGE_SIZE}&start=${start}`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Authorization': authHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch activities: ${response.statusText}`);
    }
    
    const activities = await response.json();
    
    if (!Array.isArray(activities) || activities.length === 0) {
      hasMore = false;
      break;
    }
    
    // Filter activities by date if not initial sync
    let filteredActivities = activities;
    if (lastSyncTime && !isInitialSync) {
      filteredActivities = activities.filter(activity => {
        const activityDate = new Date(activity.startTimeLocal);
        return activityDate > new Date(lastSyncTime);
      });
    }
    
    allActivities.push(...filteredActivities);
    
    // If we got filtered results and they're from before our sync time, we can stop
    if (filteredActivities.length < activities.length) {
      hasMore = false;
    }
    
    start += PAGE_SIZE;
    
    // Prevent infinite loops
    if (activities.length < PAGE_SIZE) {
      hasMore = false;
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return allActivities;
}

/**
 * Process and store activities in database
 */
async function processAndStoreActivities(activities, authHeader, env) {
  let processedCount = 0;
  
  for (const activity of activities) {
    try {
      // Check if activity already exists
      const existing = await getActivityById(activity.activityId, env);
      if (existing && !shouldUpdateActivity(existing, activity)) {
        continue;
      }
      
      // Enrich strength training activities with exercise sets
      if (activity.activityType?.typeKey === 'strength_training') {
        activity.fullExerciseSets = await fetchActivityExerciseSets(activity.activityId, authHeader);
      }
      
      // Process activity data
      const processedActivity = processActivityData(activity);
      
      // Store in database
      await storeActivity(processedActivity, env);
      processedCount++;
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
      
    } catch (error) {
      console.error(`Failed to process activity ${activity.activityId}:`, error);
    }
  }
  
  return processedCount;
}

/**
 * Fetch exercise sets for a strength training activity
 */
async function fetchActivityExerciseSets(activityId, authHeader) {
  try {
    const url = `${GARMIN_BASE_URL}/activity-service/activity/${activityId}/exerciseSets`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    if (!response.ok) {
      console.warn(`Failed to fetch exercise sets for ${activityId}`);
      return [];
    }
    
    const data = await response.json();
    return data.exerciseSets || [];
    
  } catch (error) {
    console.error(`Error fetching exercise sets for ${activityId}:`, error);
    return [];
  }
}

/**
 * Process activity data based on type
 */
function processActivityData(activity) {
  const baseActivity = {
    id: activity.activityId,
    name: activity.activityName,
    type: activity.activityType?.typeKey || 'unknown',
    startTime: activity.startTimeLocal,
    duration: activity.duration,
    movingTime: activity.movingDuration,
    calories: activity.calories,
    averageHR: activity.averageHR,
    maxHR: activity.maxHR,
    distance: activity.distance,
    averageSpeed: activity.averageSpeed,
    maxSpeed: activity.maxSpeed,
    elevationGain: activity.elevationGain,
    elevationLoss: activity.elevationLoss,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  // Process strength training activities
  if (activity.activityType?.typeKey === 'strength_training' && activity.fullExerciseSets) {
    baseActivity.exerciseSets = processExerciseSets(activity.fullExerciseSets);
    baseActivity.totalReps = activity.totalReps;
    baseActivity.totalSets = activity.totalSets;
  }
  
  // Process cycling/running activities
  if (['cycling', 'running', 'walking'].includes(activity.activityType?.typeKey)) {
    baseActivity.averagePower = activity.avgPower;
    baseActivity.maxPower = activity.maxPower;
    baseActivity.normalizedPower = activity.normalizedPower;
    baseActivity.trainingStressScore = activity.trainingStressScore;
    baseActivity.averageCadence = activity.avgRunCadence || activity.avgBikeCadence;
    baseActivity.maxCadence = activity.maxRunCadence || activity.maxBikeCadence;
  }
  
  return baseActivity;
}

/**
 * Process exercise sets data similar to sample-file-processor.svelte
 */
function processExerciseSets(exerciseSets) {
  return exerciseSets.map(exerciseSet => {
    const sets = [];
    
    if (exerciseSet.sets && Array.isArray(exerciseSet.sets)) {
      exerciseSet.sets.forEach(set => {
        // Include all sets without filtering
        sets.push({
          reps: set.repetitionCount || 0,
          weight: set.weight ? Math.round(set.weight / 1000 * 100) / 100 : null, // Convert grams to kg
          duration: set.duration,
          restTime: set.restTime
        });
      });
    }
    
    return {
      exerciseName: exerciseSet.exerciseName,
      category: exerciseSet.category,
      sets: sets,
      totalReps: sets.reduce((sum, set) => sum + (set.reps || 0), 0),
      totalVolume: sets.reduce((sum, set) => sum + ((set.reps || 0) * (set.weight || 0)), 0)
    };
  }); // Removed filter that excluded exercises with no sets
}

/**
 * Database functions (implement based on your chosen database)
 */
async function getLastSyncTime(env) {
  // Implement database query to get last sync timestamp
  // This could be from a metadata table or KV store
  return await env.GARMIN_SYNC_KV.get('lastSyncTime');
}

async function updateLastSyncTime(env) {
  const now = new Date().toISOString();
  await env.GARMIN_SYNC_KV.put('lastSyncTime', now);
}

async function getActivityById(activityId, env) {
  // Check if activity exists in database
  const query = `SELECT id FROM ${ACTIVITIES_TABLE} WHERE id = ?`;
  const result = await env.DATABASE.prepare(query).bind(activityId).first();
  return result;
}

async function shouldUpdateActivity(existing, newActivity) {
  // Determine if activity should be updated (e.g., if it was modified)
  return false; // For now, don't update existing activities
}

async function storeActivity(activity, env) {
  // Store main activity data
  const activityQuery = `
    INSERT OR REPLACE INTO ${ACTIVITIES_TABLE} 
    (id, name, type, start_time, duration, moving_time, calories, 
     average_hr, max_hr, distance, average_speed, max_speed, 
     elevation_gain, elevation_loss, average_power, max_power,
     normalized_power, training_stress_score, average_cadence, max_cadence,
     total_reps, total_sets, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  await env.DATABASE.prepare(activityQuery).bind(
    activity.id, activity.name, activity.type, activity.startTime,
    activity.duration, activity.movingTime, activity.calories,
    activity.averageHR, activity.maxHR, activity.distance,
    activity.averageSpeed, activity.maxSpeed, activity.elevationGain,
    activity.elevationLoss, activity.averagePower, activity.maxPower,
    activity.normalizedPower, activity.trainingStressScore,
    activity.averageCadence, activity.maxCadence, activity.totalReps,
    activity.totalSets, activity.createdAt, activity.updatedAt
  ).run();
  
  // Store exercise sets for strength training
  if (activity.exerciseSets && activity.exerciseSets.length > 0) {
    // First, delete existing exercise sets for this activity
    await env.DATABASE.prepare(`DELETE FROM ${EXERCISE_SETS_TABLE} WHERE activity_id = ?`)
      .bind(activity.id).run();
    
    // Insert new exercise sets
    for (const exercise of activity.exerciseSets) {
      for (let i = 0; i < exercise.sets.length; i++) {
        const set = exercise.sets[i];
        const setQuery = `
          INSERT INTO ${EXERCISE_SETS_TABLE}
          (activity_id, exercise_name, category, set_number, reps, weight, duration, rest_time, total_volume)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await env.DATABASE.prepare(setQuery).bind(
          activity.id, exercise.exerciseName, exercise.category,
          i + 1, set.reps, set.weight, set.duration, set.restTime,
          set.reps * (set.weight || 0)
        ).run();
      }
    }
  }
}

// Export for testing
export {
  handleRequest,
  handleScheduled,
  syncGarminData,
  authenticateGarmin,
  fetchActivities,
  processActivityData
};
