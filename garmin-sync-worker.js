/**
 * Cloudflare Workers script for Garmin Connect data synchronization
 * Runs daily or on webhook trigger to sync workout data to database
 */

// Configuration
const GARMIN_BASE_URL = 'https://connectapi.garmin.com';
const GARMIN_SSO_URL = 'https://sso.garmin.com';
const PAGE_SIZE = 20;

// Database table names (adjust based on your database schema)
const ACTIVITIES_TABLE = 'activities';
const EXERCISE_SETS_TABLE = 'exercise_sets';

// Activity types that typically have outdoor GPS/weather data
const OUTDOOR_ACTIVITIES = ['running', 'cycling', 'walking', 'hiking', 'mountain_biking', 'road_biking', 'trail_running'];

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

  // Endpoint: 10 most recent activities
  if (url.pathname === '/recent-activities' && request.method === 'GET') {
    return handleGetRecentActivities(request, env);
  }

  // Endpoint: stats for past week, 2 weeks, 4 weeks, year
  if (url.pathname === '/activity-stats' && request.method === 'GET') {
    return handleGetActivityStatsSummary(request, env);
  }

  // GPS activities endpoint with caching
  if (url.pathname === '/gps-activities' && request.method === 'GET') {
    return handleGetGPSActivities(request, env);
  }
  
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      }
    });
  }
  
  // Webhook endpoint for manual triggers - FAST RESPONSE (< 1 second)
  if (url.pathname === '/sync' && request.method === 'GET') {
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
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
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

  // Test Ride with GPS API endpoint
  if (url.pathname === '/test-ridewithgps' && request.method === 'GET') {
    const result = await testRideWithGPSAPI(env);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Health check endpoint
  if (url.pathname === '/health') {
    return new Response('OK', { status: 200 });
  }

  // Add import endpoint for bulk data import
  if (url.pathname === '/import-data' && request.method === 'POST') {
    return handleDataImport(request, env);
  }

  // GPS backfill endpoints
  if (url.pathname === '/activities-without-gps' && request.method === 'GET') {
    return handleGetActivitiesWithoutGPS(request, env);
  }

  if (url.pathname === '/update-gps-data' && request.method === 'POST') {
    return handleUpdateGPSData(request, env);
  }

  // Upload all activities endpoint (GPS and non-GPS)
  if (url.pathname === '/update-all-activities' && request.method === 'POST') {
    return handleUpdateAllActivities(request, env);
  }

  // Stats endpoint with cached statistics
  if (url.pathname === '/stats' && request.method === 'GET') {
    return handleGetActivityStats(request, env);
  }

  // Set sync time to latest activity endpoint
  if (url.pathname === '/set-sync-time' && request.method === 'POST') {
    const syncTime = await setLastSyncTimeToLatestActivity(env);
    return new Response(JSON.stringify({
      success: !!syncTime,
      lastSyncTime: syncTime,
      message: syncTime ? `Sync time set to ${syncTime}` : 'No activities found to set sync time'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Strength activities endpoint with caching
  if (url.pathname === '/strength-activities' && request.method === 'GET') {
    return handleGetStrengthActivities(request, env);
  }

  if (url.pathname === '/status') {
    const lastSync = await getLastSyncTime(env);
    return new Response(JSON.stringify({
      lastSync: lastSync || 'Never',
      timestamp: new Date().toISOString()
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  return new Response('Not Found', { status: 404 });
}
async function handleGetStrengthActivities(request, env) {
/**
 * Handle GET /recent-activities endpoint
 * Returns the 10 most recent activities
 */
async function handleGetRecentActivities(request, env) {
  try {
    const activitiesQuery = `
      SELECT * FROM activities
      ORDER BY start_time DESC
      LIMIT 10
    `;
    const activities = (await env.DATABASE.prepare(activitiesQuery).all()).results;
    return new Response(JSON.stringify({
      success: true,
      activities
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=600'
      }
    });
  } catch (error) {
    console.error('❌ Error getting recent activities:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Handle GET /activity-stats endpoint
 * Returns stats for the past week, 2 weeks, 4 weeks, and year
 */
async function handleGetActivityStatsSummary(request, env) {
  try {
    const now = new Date();
    // Helper to get ISO string for N days ago
    const daysAgo = (n) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d.toISOString();
    };
    // Helper to get ISO string for N years ago
    const yearsAgo = (n) => {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - n);
      return d.toISOString();
    };

    // Time windows
    const windows = [
      { label: 'week', since: daysAgo(7) },
      { label: 'two_weeks', since: daysAgo(14) },
      { label: 'four_weeks', since: daysAgo(28) },
      { label: 'year', since: yearsAgo(1) }
    ];

    // For each window, get stats
    const stats = {};
    for (const win of windows) {
      // Activities in window
      const activitiesQuery = `
        SELECT id, type, duration, distance, total_sets, total_reps
        FROM activities
        WHERE start_time >= ?
      `;
      const activities = (await env.DATABASE.prepare(activitiesQuery).bind(win.since).all()).results;

      // Aggregate stats
      let activityCount = activities.length;
      let totalTime = 0;
      let totalDistance = 0;
      let totalSets = 0;
      let totalReps = 0;
      let totalVolume = 0;

      for (const act of activities) {
        totalTime += act.duration || 0;
        totalDistance += act.distance || 0;
        totalSets += act.total_sets || 0;
        totalReps += act.total_reps || 0;
        // For volume, sum from exercise_sets table if strength
        if (act.type === 'strength_training' || act.type === 'strength') {
          const setsQuery = `SELECT SUM(total_volume) as volume FROM exercise_sets WHERE activity_id = ?`;
          const res = await env.DATABASE.prepare(setsQuery).bind(act.id).first();
          totalVolume += res?.volume || 0;
        }
      }

      stats[win.label] = {
        activityCount,
        totalTime,
        totalDistance,
        totalSets,
        totalReps,
        totalVolume
      };
    }

    return new Response(JSON.stringify({
      success: true,
      stats
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=600'
      }
    });
  } catch (error) {
    console.error('❌ Error getting activity stats summary:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
/**
 * Handle GET /gps-activities endpoint
 * Returns all activities with GPS data (distance > 0), including their GPS points if available
 * Caches the result for efficiency
 */
async function handleGetGPSActivities(request, env) {
  try {
    // Try to get cached data first
    let cached = await env.GARMIN_SYNC_KV.get('gps_activities_cache', { type: 'json' });
    if (cached) {
      return new Response(JSON.stringify({
        success: true,
        activities: cached.activities,
        lastUpdated: cached.lastUpdated,
        cached: true
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }
    // If not cached, generate and cache
    const data = await generateGPSActivities(env);
    await env.GARMIN_SYNC_KV.put('gps_activities_cache', JSON.stringify(data));
    return new Response(JSON.stringify({
      success: true,
      activities: data.activities,
      lastUpdated: data.lastUpdated,
      cached: false
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('❌ Error getting GPS activities:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Generate all activities with GPS data (distance > 0)
 * Includes their GPS points if available
 */
async function generateGPSActivities(env) {
  // Get all activities with distance > 0
  const activitiesQuery = `
    SELECT * FROM activities
    WHERE distance IS NOT NULL AND distance > 0
    ORDER BY start_time DESC
  `;
  const activities = (await env.DATABASE.prepare(activitiesQuery).all()).results;
  // For each activity, try to get GPS data if available (if stored in a gpsData/gps_points column, or skip if not present)
  // If you store GPS points in a separate table, you can join here. For now, just return the activity as-is.
  // If you want to include GPS points, add logic here to fetch them per activity.
  return {
    lastUpdated: new Date().toISOString(),
    activities
  };
}
  try {
    // Try to get cached data first
    let cached = await env.GARMIN_SYNC_KV.get('strength_activities_cache', { type: 'json' });
    if (cached) {
      return new Response(JSON.stringify({
        success: true,
        activities: cached.activities,
        lastUpdated: cached.lastUpdated,
        cached: true
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }
    // If not cached, generate and cache
    const data = await generateStrengthActivities(env);
    await env.GARMIN_SYNC_KV.put('strength_activities_cache', JSON.stringify(data));
    return new Response(JSON.stringify({
      success: true,
      activities: data.activities,
      lastUpdated: data.lastUpdated,
      cached: false
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('❌ Error getting strength activities:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Generate all strength activities with their set data
 */
async function generateStrengthActivities(env) {
  // Get all strength activities
  const activitiesQuery = `
    SELECT * FROM activities
    WHERE type = 'strength_training' OR type = 'strength'
    ORDER BY start_time DESC
  `;
  const activities = (await env.DATABASE.prepare(activitiesQuery).all()).results;
  // For each activity, get its sets
  for (const activity of activities) {
    const setsQuery = `SELECT * FROM exercise_sets WHERE activity_id = ? ORDER BY set_number ASC`;
    const sets = (await env.DATABASE.prepare(setsQuery).bind(activity.id).all()).results;
    activity.exercise_sets = sets;
  }
  return {
    lastUpdated: new Date().toISOString(),
    activities
  };
}

/**
 * Refresh strength activities cache
 */
async function refreshStrengthActivitiesCache(env) {
  try {
    const data = await generateStrengthActivities(env);
    await env.GARMIN_SYNC_KV.put('strength_activities_cache', JSON.stringify(data));
    console.log('📊 Strength activities cache refreshed');
    return data;
  } catch (error) {
    console.error('❌ Error refreshing strength activities cache:', error);
    throw error;
  }
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
 * Test Ride with GPS API connection using OAuth token
 */
async function testRideWithGPSAPI(env) {
  try {
    const accessToken = await env.GARMIN_SYNC_KV.get('ridewithgps_access_token');
    if (!accessToken) {
      return { 
        success: false, 
        error: 'No access token found. Please authenticate first.',
        authUrl: '/auth/ridewithgps'
      };
    }

    // Test API call to get user info
    const response = await fetch('https://ridewithgps.com/users/current.json', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { 
          success: false, 
          error: 'Access token expired. Please re-authenticate.',
          authUrl: '/auth/ridewithgps'
        };
      }
      return { 
        success: false, 
        error: `API call failed: ${response.status} ${response.statusText}`,
        details: await response.text().catch(() => 'No details available')
      };
    }

    const userData = await response.json();
    return { 
      success: true, 
      message: 'Successfully connected to Ride with GPS',
      user: {
        id: userData.user?.id,
        name: userData.user?.name || userData.user?.display_name,
        email: userData.user?.email
      }
    };

  } catch (error) {
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Make authenticated request to Ride with GPS API using OAuth token
 */
async function makeRideWithGPSRequest(endpoint, env, options = {}) {
  const accessToken = await env.GARMIN_SYNC_KV.get('ridewithgps_access_token');
  if (!accessToken) {
    throw new Error('No access token found. Please authenticate first.');
  }

  const url = endpoint.startsWith('http') ? endpoint : `https://ridewithgps.com${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Access token expired. Please re-authenticate.');
    }
    throw new Error(`Ride with GPS API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Handle Ride with GPS OAuth authentication
 */
async function handleRideWithGPSAuth(request, env) {
  const apiKey = env.RIDEWITHGPS_API_KEY;
  const baseUrl = new URL(request.url).origin;
  const redirectUri = `${baseUrl}/auth/ridewithgps/callback`;
  
  if (!apiKey) {
    return new Response(`
      <html><body>
        <h1>❌ Configuration Error</h1>
        <p>RIDEWITHGPS_API_KEY not configured. Please set it in your Cloudflare secrets.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }
  
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
                <h3>Webhook Setup (After Authentication)</h3>
                <p>Configure your webhook URL in Ride with GPS:</p>
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

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
    }

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
        <html><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1>✅ Authentication Successful</h1>
          <p>Connected to Ride with GPS account: <strong>${userData.user?.name || 'Unknown'}</strong></p>
          <div style="background: #f0f8ff; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <h3>Next Steps:</h3>
            <ol>
              <li>Set up webhook in your Ride with GPS account</li>
              <li>Go to: <strong>Account → API → Webhooks</strong></li>
              <li>Add this URL: <code>${new URL(request.url).origin}/ridewithgps-webhook</code></li>
              <li>Select events: <strong>Activity Created</strong>, <strong>Activity Updated</strong></li>
            </ol>
          </div>
          <p><a href="/status" style="color: #007cba;">Check sync status</a> | <a href="/test-ridewithgps" style="color: #007cba;">Test connection</a></p>
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
    const authData = await authenticateGarmin(env);
    if (!authData) {
      throw new Error('Failed to authenticate with Garmin');
    }

    // Get last sync timestamp from database
    const lastSyncTime = await getLastSyncTime(env);
    const isInitialSync = !lastSyncTime;
    
    console.log(`Last sync: ${lastSyncTime || 'Never'}, Initial sync: ${isInitialSync}`);

    if (isInitialSync) {
      // For initial sync, use batch processing to avoid subrequest limits
      return await handleInitialSync(authData, env);
    } else {
      // For regular syncs, use existing logic with smaller limits
      const activities = await fetchActivities(authData, lastSyncTime, isInitialSync);
      console.log(`Fetched ${activities.length} activities`);

      // Process and store activities with subrequest limit awareness
      const processedCount = await processAndStoreActivitiesWithLimits(activities, authData, env);
      
      await refreshActivityStats(env);
      await refreshStrengthActivitiesCache(env);
      
      await updateLastSyncTime(env);

      // Refresh activity statistics cache
      return {
        success: true,
        activitiesProcessed: processedCount,
        isInitialSync,
        timestamp: new Date().toISOString()
      };
    }
    
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
 * Handle initial sync with batch processing to avoid subrequest limits
 */
async function handleInitialSync(authData, env) {
  try {
    console.log('🚀 Starting initial sync with batch processing...');
    
    // Get sync progress from KV to resume if needed
    const progressKey = 'initial_sync_progress';
    let progress = await env.GARMIN_KV.get(progressKey, 'json') || {
      totalProcessed: 0,
      currentBatch: 0,
      completed: false,
      startTime: new Date().toISOString()
    };

    if (progress.completed) {
      console.log('✅ Initial sync already completed');
      // Clear progress and update last sync time
      await env.GARMIN_KV.delete(progressKey);
      await updateLastSyncTime(env);
      await refreshActivityStats(env);
      
      return {
        success: true,
        activitiesProcessed: progress.totalProcessed,
        isInitialSync: true,
        message: 'Initial sync completed in previous execution',
        timestamp: new Date().toISOString()
      };
    }

    const BATCH_SIZE = 50; // Process 50 activities per batch
    const MAX_SUBREQUESTS_PER_BATCH = 200; // Conservative limit (each activity can make 1-4 subrequests)
    
    // Fetch a single batch of activities
    const activities = await fetchActivitiesBatch(authData, progress.currentBatch * BATCH_SIZE, BATCH_SIZE);
    console.log(`📥 Fetched batch ${progress.currentBatch + 1}: ${activities.length} activities`);

    if (activities.length === 0) {
      // No more activities to process
      progress.completed = true;
      await env.GARMIN_KV.put(progressKey, JSON.stringify(progress));
      console.log(`✅ Initial sync completed! Total processed: ${progress.totalProcessed}`);
      
      // Update last sync time and refresh stats
      await updateLastSyncTime(env);
      await refreshActivityStats(env);
      
      // Clear progress
      await env.GARMIN_KV.delete(progressKey);
      
      return {
        success: true,
        activitiesProcessed: progress.totalProcessed,
        isInitialSync: true,
        message: 'Initial sync completed successfully',
        timestamp: new Date().toISOString()
      };
    }

    // Process this batch with subrequest limits
    const processedCount = await processAndStoreActivitiesWithLimits(activities, authData, env, MAX_SUBREQUESTS_PER_BATCH);
    
    // Update progress
    progress.totalProcessed += processedCount;
    progress.currentBatch += 1;
    await env.GARMIN_KV.put(progressKey, JSON.stringify(progress));
    
    console.log(`📊 Batch ${progress.currentBatch} complete. Processed: ${processedCount}/${activities.length}, Total: ${progress.totalProcessed}`);
    
    return {
      success: true,
      activitiesProcessed: processedCount,
      totalProcessed: progress.totalProcessed,
      currentBatch: progress.currentBatch,
      isInitialSync: true,
      message: `Batch ${progress.currentBatch} completed. Run sync again to continue.`,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Initial sync error:', error);
    // Don't clear progress on error so we can resume
    return {
      success: false,
      error: error.message,
      isInitialSync: true,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Authenticate with Garmin Connect using simplified OAuth flow similar to garth
 */
async function authenticateGarmin(env) {
  try {
    const username = env.GARMIN_USERNAME;
    const password = env.GARMIN_PASSWORD;
    
    if (!username || !password) {
      throw new Error('Garmin credentials not provided');
    }

    console.log('Starting Garmin authentication (garth-style)...');

    // Step 1: Get OAuth consumer keys (like garth does)
    const consumerResponse = await fetch('https://thegarth.s3.amazonaws.com/oauth_consumer.json');
    if (!consumerResponse.ok) {
      throw new Error('Failed to get OAuth consumer keys');
    }
    const consumer = await consumerResponse.json();
    console.log('Got OAuth consumer keys');

    // Step 2: Set up SSO embed session
    const domain = 'garmin.com';
    const SSO = `https://sso.${domain}/sso`;
    const SSO_EMBED = `${SSO}/embed`;
    
    const embedParams = {
      id: 'gauth-widget',
      embedWidget: 'true',
      gauthHost: SSO
    };

    let cookies = '';

    // Initial embed request to set cookies
    const embedResponse = await fetch(`${SSO_EMBED}?${new URLSearchParams(embedParams)}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!embedResponse.ok) {
      throw new Error(`Failed to initialize embed session: ${embedResponse.status}`);
    }

    // Collect cookies
    const embedCookies = embedResponse.headers.get('set-cookie');
    if (embedCookies) {
      cookies = embedCookies.split(',').map(c => c.split(';')[0].trim()).join('; ');
    }

    console.log('Initialized embed session');

    // Step 3: Get signin form with proper parameters
    const signinParams = {
      ...embedParams,
      service: SSO_EMBED,
      source: SSO_EMBED,
      redirectAfterAccountLoginUrl: SSO_EMBED,
      redirectAfterAccountCreationUrl: SSO_EMBED
    };

    const signinFormResponse = await fetch(`${SSO}/signin?${new URLSearchParams(signinParams)}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `${SSO_EMBED}?${new URLSearchParams(embedParams)}`,
        'Cookie': cookies
      }
    });

    if (!signinFormResponse.ok) {
      throw new Error(`Failed to get signin form: ${signinFormResponse.status}`);
    }

    const signinHtml = await signinFormResponse.text();
    
    // Extract CSRF token
    const csrfMatch = signinHtml.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!csrfMatch) {
      throw new Error('Could not find CSRF token');
    }
    const csrfToken = csrfMatch[1];

    // Update cookies
    const formCookies = signinFormResponse.headers.get('set-cookie');
    if (formCookies) {
      const newCookies = formCookies.split(',').map(c => c.split(';')[0].trim()).join('; ');
      cookies = cookies ? `${cookies}; ${newCookies}` : newCookies;
    }

    console.log('Got signin form and CSRF token');

    // Step 4: Submit login credentials
    const loginData = new URLSearchParams({
      username: username,
      password: password,
      embed: 'true',
      _csrf: csrfToken
    });

    const loginResponse = await fetch(`${SSO}/signin?${new URLSearchParams(signinParams)}`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${SSO}/signin?${new URLSearchParams(signinParams)}`,
        'Cookie': cookies
      },
      body: loginData.toString()
    });

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status}`);
    }

    const loginHtml = await loginResponse.text();
    
    // Update cookies from login
    const loginCookies = loginResponse.headers.get('set-cookie');
    if (loginCookies) {
      const newCookies = loginCookies.split(',').map(c => c.split(';')[0].trim()).join('; ');
      cookies = cookies ? `${cookies}; ${newCookies}` : newCookies;
    }

    // Check login success
    const titleMatch = loginHtml.match(/<title>(.+?)<\/title>/);
    const title = titleMatch ? titleMatch[1] : '';
    
    console.log(`Login response title: ${title}`);

    if (title !== 'Success' && !title.includes('Success')) {
      throw new Error(`Login failed with title: ${title}`);
    }

    console.log('Login successful, extracting ticket...');

    // Step 5: Extract ticket from response
    const ticketMatch = loginHtml.match(/embed\?ticket=([^"]+)"/);
    if (!ticketMatch) {
      throw new Error('Could not find ticket in login response');
    }

    const ticket = ticketMatch[1];
    console.log('Extracted authentication ticket');

    // Step 6: Get OAuth1 preauthorized token using the ticket
    const baseUrl = `https://connectapi.${domain}/oauth-service/oauth/`;
    const loginUrl = `https://sso.${domain}/sso/embed`;
    
    // Create OAuth1 parameters for the preauthorized request
    const oauthParams = {
      'oauth_consumer_key': consumer.consumer_key,
      'oauth_nonce': generateNonce(),
      'oauth_signature_method': 'HMAC-SHA1',
      'oauth_timestamp': Math.floor(Date.now() / 1000).toString(),
      'oauth_version': '1.0',
      'ticket': ticket,
      'login-url': loginUrl,
      'accepts-mfa-tokens': 'true'
    };

    // Generate OAuth1 signature
    const preAuthUrl = `${baseUrl}preauthorized`;
    const signature = await generateOAuth1Signature('GET', preAuthUrl, oauthParams, consumer.consumer_secret);
    oauthParams.oauth_signature = signature;

    // Build the request URL with all OAuth parameters
    const queryParams = new URLSearchParams(oauthParams);
    const fullPreAuthUrl = `${preAuthUrl}?${queryParams.toString()}`;

    const oauth1Response = await fetch(fullPreAuthUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'com.garmin.android.apps.connectmobile',
        'Accept': '*/*'
      }
    });

    if (!oauth1Response.ok) {
      const errorText = await oauth1Response.text().catch(() => 'No error details');
      console.log(`OAuth1 response status: ${oauth1Response.status}`);
      console.log(`OAuth1 error body:`, errorText);
      throw new Error(`Failed to get OAuth1 token: ${oauth1Response.status} - ${errorText}`);
    }

    const oauth1Text = await oauth1Response.text();
    console.log('Got OAuth1 response');

    // Parse OAuth1 response (URL-encoded format)
    const oauth1Params = new URLSearchParams(oauth1Text);
    const oauth1Token = {
      oauth_token: oauth1Params.get('oauth_token'),
      oauth_token_secret: oauth1Params.get('oauth_token_secret'),
      mfa_token: oauth1Params.get('mfa_token')
    };

    if (!oauth1Token.oauth_token || !oauth1Token.oauth_token_secret) {
      throw new Error('Failed to extract OAuth1 token from response');
    }

    console.log('Successfully extracted OAuth1 token');

    // Step 7: Exchange OAuth1 for OAuth2 Bearer token
    const exchangeUrl = `${baseUrl}exchange/user/2.0`;
    const exchangeBody = oauth1Token.mfa_token ? `mfa_token=${oauth1Token.mfa_token}` : '';

    // Create OAuth1 parameters for the exchange request
    const exchangeOAuthParams = {
      'oauth_consumer_key': consumer.consumer_key,
      'oauth_token': oauth1Token.oauth_token,
      'oauth_nonce': generateNonce(),
      'oauth_signature_method': 'HMAC-SHA1',
      'oauth_timestamp': Math.floor(Date.now() / 1000).toString(),
      'oauth_version': '1.0'
    };

    // Add mfa_token to OAuth parameters if present
    if (oauth1Token.mfa_token) {
      exchangeOAuthParams.mfa_token = oauth1Token.mfa_token;
    }

    // Generate OAuth1 signature for the exchange request
    const exchangeSignature = await generateOAuth1Signature('POST', exchangeUrl, exchangeOAuthParams, consumer.consumer_secret, oauth1Token.oauth_token_secret);
    exchangeOAuthParams.oauth_signature = exchangeSignature;

    // Build the Authorization header
    const oauthHeaderParams = [
      `oauth_consumer_key="${encodeURIComponent(exchangeOAuthParams.oauth_consumer_key)}"`,
      `oauth_token="${encodeURIComponent(exchangeOAuthParams.oauth_token)}"`,
      `oauth_signature_method="${encodeURIComponent(exchangeOAuthParams.oauth_signature_method)}"`,
      `oauth_timestamp="${encodeURIComponent(exchangeOAuthParams.oauth_timestamp)}"`,
      `oauth_nonce="${encodeURIComponent(exchangeOAuthParams.oauth_nonce)}"`,
      `oauth_version="${encodeURIComponent(exchangeOAuthParams.oauth_version)}"`,
      `oauth_signature="${encodeURIComponent(exchangeOAuthParams.oauth_signature)}"`
    ];
    
    const authHeader = `OAuth ${oauthHeaderParams.join(', ')}`;

    const oauth2Response = await fetch(exchangeUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'com.garmin.android.apps.connectmobile',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': authHeader
      },
      body: exchangeBody
    });

    if (!oauth2Response.ok) {
      const errorText = await oauth2Response.text();
      throw new Error(`Failed to exchange OAuth1 for OAuth2: ${oauth2Response.status} - ${errorText}`);
    }

    const oauth2Data = await oauth2Response.json();
    console.log('Successfully exchanged for OAuth2 token');
    
    if (!oauth2Data.access_token) {
      throw new Error('No access_token in OAuth2 response');
    }

    // Step 8: Test the Bearer token with Garmin API
    const testHeaders = {
      'User-Agent': 'com.garmin.android.apps.connectmobile',
      'Authorization': `Bearer ${oauth2Data.access_token}`,
      'Accept': 'application/json'
    };

    const testResponse = await fetch(`${GARMIN_BASE_URL}/activitylist-service/activities/search/activities?limit=1&start=0`, {
      headers: testHeaders
    });

    console.log(`API test response status: ${testResponse.status}`);

    if (!testResponse.ok) {
      const responseText = await testResponse.text().catch(() => 'No response text');
      console.log('API test response body:', responseText);
      throw new Error(`API test failed: ${testResponse.status} ${testResponse.statusText}`);
    }

    console.log('Garmin authentication successful! API access confirmed.');
    
    // Return the Bearer token for subsequent requests
    return {
      bearerToken: oauth2Data.access_token,
      cookies: cookies,
      expiresIn: oauth2Data.expires_in || 3600
    };
    
  } catch (error) {
    console.error('Garmin authentication failed:', error);
    return null;
  }
}

/**
 * Fetch activities from Garmin Connect
 */
async function fetchActivities(authData, lastSyncTime, isInitialSync) {
  const allActivities = [];
  let start = 0;
  let hasMore = true;
  const maxActivities = isInitialSync ? 1500 : 100; // Limit for initial sync
  const ALWAYS_UPDATE_COUNT = 8; // Always refresh the last 8 activities
  
  while (hasMore && allActivities.length < maxActivities) {
    const url = `${GARMIN_BASE_URL}/activitylist-service/activities/search/activities?limit=${PAGE_SIZE}&start=${start}`;
    
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'com.garmin.android.apps.connectmobile',
      'Authorization': `Bearer ${authData.bearerToken}`
    };
    
    const response = await fetch(url, { headers });
    
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
      
      // Always include the first ALWAYS_UPDATE_COUNT activities (most recent) for potential updates
      // even if they're older than lastSyncTime
      if (start === 0) {
        const recentActivities = activities.slice(0, ALWAYS_UPDATE_COUNT);
        const newActivities = filteredActivities;
        
        // Combine recent activities (for updates) with new activities (new since last sync)
        // Remove duplicates by activity ID
        const combinedMap = new Map();
        
        // Add new activities first
        newActivities.forEach(activity => {
          combinedMap.set(activity.activityId, { ...activity, isNew: true });
        });
        
        // Add recent activities, marking them as potentially needing updates
        recentActivities.forEach(activity => {
          if (!combinedMap.has(activity.activityId)) {
            combinedMap.set(activity.activityId, { ...activity, isRecentUpdate: true });
          } else {
            // Mark as both new and recent (highest priority)
            combinedMap.get(activity.activityId).isRecentUpdate = true;
          }
        });
        
        filteredActivities = Array.from(combinedMap.values());
        console.log(`📅 Including ${recentActivities.length} recent activities for potential updates`);
      }
    }
    
    allActivities.push(...filteredActivities);
    
    // If we got filtered results and they're from before our sync time, we can stop
    // But continue until we've checked at least ALWAYS_UPDATE_COUNT activities
    if (filteredActivities.length < activities.length && start >= ALWAYS_UPDATE_COUNT) {
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
  
  console.log(`📊 Fetched ${allActivities.length} activities (including recent updates check)`);
  return allActivities;
}

/**
 * Fetch a single batch of activities for batch processing
 */
async function fetchActivitiesBatch(authData, start, limit) {
  const url = `${GARMIN_BASE_URL}/activitylist-service/activities/search/activities?limit=${limit}&start=${start}`;
  
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'com.garmin.android.apps.connectmobile',
    'Authorization': `Bearer ${authData.bearerToken}`
  };
  
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch activities batch: ${response.statusText}`);
  }
  
  const activities = await response.json();
  return Array.isArray(activities) ? activities : [];
}

/**
 * Process and store activities in database
 */
async function processAndStoreActivities(activities, authData, env) {
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
        activity.fullExerciseSets = await fetchActivityExerciseSets(activity.activityId, authData);
      }
      
      // Enrich GPS activities with route data
      if (activity.distance && activity.distance > 0 && ['running', 'cycling', 'walking', 'hiking', 'mountain_biking'].includes(activity.activityType?.typeKey)) {
        activity.gpsData = await fetchActivityRouteData(activity.activityId, authData);
      }
      
      // Enrich outdoor activities with weather data
      if (OUTDOOR_ACTIVITIES.includes(activity.activityType?.typeKey)) {
        activity.weatherData = await fetchActivityWeatherData(activity.activityId, authData);
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
 * Process and store activities with subrequest limit awareness
 */
async function processAndStoreActivitiesWithLimits(activities, authData, env, maxSubrequests = 200) {
  let processedCount = 0;
  let subrequestCount = 0;
  
  console.log(`🔄 Processing ${activities.length} activities (max ${maxSubrequests} subrequests)...`);
  
  for (const activity of activities) {
    try {
      // Estimate subrequests needed for this activity
      let estimatedSubrequests = 0;
      
      // Base activity processing (no extra subrequests)
      estimatedSubrequests += 0;
      
      // Exercise sets for strength training
      if (activity.activityType?.typeKey === 'strength_training') {
        estimatedSubrequests += 1;
      }
      
      // GPS data for activities with distance
      if (activity.distance && activity.distance > 0 && 
          ['running', 'cycling', 'walking', 'hiking', 'mountain_biking'].includes(activity.activityType?.typeKey)) {
        estimatedSubrequests += 1;
      }
      
      // Weather data for outdoor activities
      if (OUTDOOR_ACTIVITIES.includes(activity.activityType?.typeKey)) {
        estimatedSubrequests += 1;
      }
      
      // Check if we would exceed subrequest limit
      if (subrequestCount + estimatedSubrequests > maxSubrequests) {
        console.log(`⚠️ Approaching subrequest limit (${subrequestCount}/${maxSubrequests}). Stopping batch processing.`);
        break;
      }
      
      // Check if activity already exists
      const existing = await getActivityById(activity.activityId, env);
      if (existing && !shouldUpdateActivity(existing, activity)) {
        continue;
      }
      
      console.log(`📝 Processing activity ${activity.activityId} (${activity.activityType?.typeKey || 'unknown'})`);
      
      // Enrich strength training activities with exercise sets
      if (activity.activityType?.typeKey === 'strength_training') {
        console.log(`💪 Fetching exercise sets for strength training activity ${activity.activityId}`);
        activity.fullExerciseSets = await fetchActivityExerciseSets(activity.activityId, authData);
        subrequestCount += 1;
      }
      
      // Enrich GPS activities with route data
      if (activity.distance && activity.distance > 0 && 
          ['running', 'cycling', 'walking', 'hiking', 'mountain_biking'].includes(activity.activityType?.typeKey)) {
        console.log(`🗺️ Fetching GPS data for activity ${activity.activityId}`);
        activity.gpsData = await fetchActivityRouteData(activity.activityId, authData);
        subrequestCount += 1;
      }
      
      // Enrich outdoor activities with weather data
      if (OUTDOOR_ACTIVITIES.includes(activity.activityType?.typeKey)) {
        console.log(`🌤️ Fetching weather data for activity ${activity.activityId}`);
        activity.weatherData = await fetchActivityWeatherData(activity.activityId, authData);
        subrequestCount += 1;
      }
      
      // Process activity data
      const processedActivity = processActivityData(activity);
      
      // Store in database
      await storeActivity(processedActivity, env);
      processedCount++;
      
      console.log(`✅ Stored activity ${activity.activityId}. Processed: ${processedCount}, Subrequests used: ${subrequestCount}`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
      
    } catch (error) {
      console.error(`❌ Failed to process activity ${activity.activityId}:`, error);
    }
  }
  
  console.log(`📊 Batch complete: ${processedCount} activities processed, ${subrequestCount} subrequests used`);
  return processedCount;
}

/**
 * Fetch exercise sets for a strength training activity
 */
async function fetchActivityExerciseSets(activityId, authData) {
  try {
    const url = `${GARMIN_BASE_URL}/activity-service/activity/${activityId}/exerciseSets`;
    
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'com.garmin.android.apps.connectmobile',
      'Authorization': `Bearer ${authData.bearerToken}`
    };

    const response = await fetch(url, { headers });
    
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
 * Fetch GPS route data for an activity using the polyline endpoint
 */
async function fetchActivityRouteData(activityId, authData) {
  try {
    const url = `${GARMIN_BASE_URL}/activity-service/activity/${activityId}/polyline/full-resolution/?_=${Date.now()}`;
    
    const headers = {
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'accept-language': 'en-US,en;q=0.9',
      'authorization': `Bearer ${authData.bearerToken}`,
      'cache-control': 'no-cache',
      'di-backend': 'connectapi.garmin.com',
      'nk': 'NT',
      'pragma': 'no-cache',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'x-requested-with': 'XMLHttpRequest'
    };

    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.warn(`Failed to fetch GPS data for ${activityId}: ${response.status}`);
      return { hasPolyline: false };
    }
    
    const data = await response.json();
    
    // Process the polyline data from the new endpoint
    if (data.polyline && Array.isArray(data.polyline) && data.polyline.length > 0) {
      // Convert polyline format: [timestamp, lat, lon] to {lat, lon, timestamp}
      const gpsPoints = data.polyline.map(point => ({
        timestamp: point[0], // Unix timestamp
        lat: point[1],       // Latitude
        lon: point[2]        // Longitude
      }));
      
      if (gpsPoints.length > 0) {
        return {
          gpsPoints: gpsPoints,
          startLatitude: gpsPoints[0].lat,
          startLongitude: gpsPoints[0].lon,
          endLatitude: gpsPoints[gpsPoints.length - 1].lat,
          endLongitude: gpsPoints[gpsPoints.length - 1].lon,
          minLatitude: data.minLat,
          maxLatitude: data.maxLat,
          minLongitude: data.minLon,
          maxLongitude: data.maxLon,
          hasPolyline: true,
          totalGpsPoints: gpsPoints.length
        };
      }
    }
    
    return { hasPolyline: false };
    
  } catch (error) {
    console.error(`Error fetching route data for ${activityId}:`, error);
    return { hasPolyline: false };
  }
}

/**
 * Fetch weather data for an activity
 */
async function fetchActivityWeatherData(activityId, authData) {
  try {
    const url = `${GARMIN_BASE_URL}/activity-service/activity/${activityId}/weather?_=${Date.now()}`;
    
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'com.garmin.android.apps.connectmobile',
      'Authorization': `Bearer ${authData.bearerToken}`
    };

    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.warn(`Failed to fetch weather data for ${activityId}`);
      return { hasWeatherData: false };
    }
    
    const weather = await response.json();
    
    return {
      temperature: weather.temp,
      apparentTemperature: weather.apparentTemp,
      humidity: weather.relativeHumidity,
      dewPoint: weather.dewPoint,
      windSpeed: weather.windSpeed,
      windDirection: weather.windDirection,
      windDirectionCompass: weather.windDirectionCompassPoint,
      windGust: weather.windGust,
      weatherDescription: weather.weatherTypeDTO?.desc,
      weatherStation: weather.weatherStationDTO?.name,
      issueDate: weather.issueDate,
      hasWeatherData: true
    };
    
  } catch (error) {
    console.error(`Error fetching weather data for ${activityId}:`, error);
    return { hasWeatherData: false };
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
  if (activity.activityType?.typeKey === 'strength_training') {
    if (activity.fullExerciseSets) {
      const processedSets = processExerciseSets(activity.fullExerciseSets);
      baseActivity.exerciseSets = processedSets.exerciseSets;
      baseActivity.workoutTiming = processedSets.workoutTiming;
    }
    // Include strength training totals from the activity (from Garmin API)
    baseActivity.totalReps = activity.totalReps;
    baseActivity.totalSets = activity.totalSets;
  }
  
  // Process GPS activities
  if (activity.gpsData) {
    baseActivity.gpsData = activity.gpsData;
  }
  
  // Process weather data
  if (activity.weatherData) {
    baseActivity.weatherData = activity.weatherData;
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
 * Process exercise sets data with working/rest time calculations
 */
function processExerciseSets(exerciseSets) {
  // Group sets by exercise type
  const exerciseGroups = {};
  const activeSets = exerciseSets.filter(set => set.setType === 'ACTIVE');
  const restSets = exerciseSets.filter(set => set.setType === 'REST');
  
  // Calculate total working vs rest time
  const totalWorkingTime = activeSets.reduce((sum, set) => sum + (set.duration || 0), 0);
  const totalRestTime = restSets.reduce((sum, set) => sum + (set.duration || 0), 0);
  
  activeSets.forEach(set => {
    if (set.exercises && set.exercises.length > 0) {
      const exercise = set.exercises[0];
      const exerciseKey = exercise.category + (exercise.name ? `_${exercise.name}` : '');
      
      if (!exerciseGroups[exerciseKey]) {
        exerciseGroups[exerciseKey] = {
          exerciseName: exercise.name || exercise.category,
          category: exercise.category,
          sets: [],
          totalWorkingTime: 0
        };
      }
      
      exerciseGroups[exerciseKey].sets.push({
        reps: set.repetitionCount || 0,
        weight: set.weight ? Math.round(set.weight / 1000 * 100) / 100 : null, // Convert from milligrams to kg
        duration: set.duration,
        startTime: set.startTime
      });
      
      exerciseGroups[exerciseKey].totalWorkingTime += (set.duration || 0);
    }
  });
  
  // Convert to array format and calculate totals
  const processedExercises = Object.values(exerciseGroups).map(exercise => ({
    ...exercise,
    totalReps: exercise.sets.reduce((sum, set) => sum + (set.reps || 0), 0),
    totalVolume: exercise.sets.reduce((sum, set) => sum + ((set.reps || 0) * (set.weight || 0)), 0),
    totalSets: exercise.sets.length,
    totalWorkingTime: Math.round(exercise.totalWorkingTime) // seconds
  }));
  
  // Calculate workout timing summary
  const workoutTiming = {
    totalWorkingTime: Math.round(totalWorkingTime), // seconds
    totalRestTime: Math.round(totalRestTime), // seconds
    totalTime: Math.round(totalWorkingTime + totalRestTime), // seconds
    workToRestRatio: totalRestTime > 0 ? Math.round((totalWorkingTime / totalRestTime) * 100) / 100 : null,
    workPercentage: totalWorkingTime + totalRestTime > 0 ? Math.round((totalWorkingTime / (totalWorkingTime + totalRestTime)) * 100) : 0
  };
  
  return {
    exerciseSets: processedExercises,
    workoutTiming: workoutTiming
  };
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

// Set sync time to the latest activity's start time
async function setLastSyncTimeToLatestActivity(env) {
  try {
    const query = `SELECT start_time FROM ${ACTIVITIES_TABLE} ORDER BY start_time DESC LIMIT 1`;
    const result = await env.DATABASE.prepare(query).first();
    
    if (result && result.start_time) {
      await env.GARMIN_SYNC_KV.put('lastSyncTime', result.start_time);
      console.log(`🕒 Set last sync time to latest activity: ${result.start_time}`);
      return result.start_time;
    } else {
      console.log('⚠️ No activities found in database');
      return null;
    }
  } catch (error) {
    console.error('❌ Error setting sync time to latest activity:', error);
    return null;
  }
}

async function getActivityById(activityId, env) {
  // Check if activity exists in database
  const query = `SELECT id FROM ${ACTIVITIES_TABLE} WHERE id = ?`;
  const result = await env.DATABASE.prepare(query).bind(activityId).first();
  return result;
}

async function shouldUpdateActivity(existing, newActivity) {
  // Always update if this is marked as a recent activity that should be refreshed
  if (newActivity.isRecentUpdate) {
    console.log(`🔄 Updating recent activity: ${newActivity.activityName || 'Unknown'} (${newActivity.activityId})`);
    return true;
  }
  
  // For other activities, don't update existing ones
  // In the future, we could check if certain fields have changed
  return false;
}

async function storeActivity(activity, env) {
  // Helper function to convert undefined to null for database compatibility
  const nullIfUndefined = (value) => value === undefined ? null : value;
  
  // Log strength training data being stored
  if (activity.type === 'strength_training' || activity.type === 'strength') {
    console.log(`💪 Storing strength training activity ${activity.id}:`, {
      totalReps: activity.totalReps,
      totalSets: activity.totalSets,
      hasExerciseSets: !!(activity.exerciseSets && activity.exerciseSets.length > 0),
      hasWorkoutTiming: !!activity.workoutTiming,
      workoutTiming: activity.workoutTiming
    });
  }
  
  // Store main activity data
  const activityQuery = `
    INSERT OR REPLACE INTO ${ACTIVITIES_TABLE} 
    (id, name, type, start_time, duration, moving_time, calories, 
     average_hr, max_hr, distance, average_speed, max_speed, 
     elevation_gain, elevation_loss, average_power, max_power,
     normalized_power, training_stress_score, average_cadence, max_cadence,
     total_reps, total_sets, 
     gps_polyline, start_latitude, start_longitude, end_latitude, end_longitude, 
     total_gps_points, has_gps_data,
     temperature, apparent_temperature, humidity, dew_point, wind_speed, wind_direction,
     wind_direction_compass, wind_gust, weather_description, weather_station, 
     weather_issue_date, has_weather_data,
     total_working_time, total_rest_time, work_to_rest_ratio, work_percentage,
     created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
            ?, ?, ?, ?, ?, ?, ?, 
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?)
  `;
  
  // Prepare GPS data for storage
  let gpsPolyline = null;
  let totalGpsPoints = 0;
  
  if (activity.gpsData?.gpsPoints && activity.gpsData.gpsPoints.length > 0) {
    // Store GPS points as JSON string
    gpsPolyline = JSON.stringify(activity.gpsData.gpsPoints);
    totalGpsPoints = activity.gpsData.gpsPoints.length;
  } else if (activity.gpsData?.polyline) {
    // Store existing polyline format
    gpsPolyline = JSON.stringify(activity.gpsData.polyline);
    totalGpsPoints = Array.isArray(activity.gpsData.polyline) ? activity.gpsData.polyline.length : 0;
  } else if (activity.gpsData?.totalGpsPoints) {
    // Use provided total if available
    totalGpsPoints = activity.gpsData.totalGpsPoints;
  }
  
  await env.DATABASE.prepare(activityQuery).bind(
    nullIfUndefined(activity.id), 
    nullIfUndefined(activity.name), 
    nullIfUndefined(activity.type), 
    nullIfUndefined(activity.startTime),
    nullIfUndefined(activity.duration), 
    nullIfUndefined(activity.movingTime), 
    nullIfUndefined(activity.calories),
    nullIfUndefined(activity.averageHR), 
    nullIfUndefined(activity.maxHR), 
    nullIfUndefined(activity.distance),
    nullIfUndefined(activity.averageSpeed), 
    nullIfUndefined(activity.maxSpeed), 
    nullIfUndefined(activity.elevationGain),
    nullIfUndefined(activity.elevationLoss), 
    nullIfUndefined(activity.averagePower), 
    nullIfUndefined(activity.maxPower),
    nullIfUndefined(activity.normalizedPower), 
    nullIfUndefined(activity.trainingStressScore),
    nullIfUndefined(activity.averageCadence), 
    nullIfUndefined(activity.maxCadence), 
    nullIfUndefined(activity.totalReps),
    nullIfUndefined(activity.totalSets), 
    // GPS data - store GPS points as JSON or existing polyline
    gpsPolyline,
    nullIfUndefined(activity.gpsData?.startLatitude),
    nullIfUndefined(activity.gpsData?.startLongitude),
    nullIfUndefined(activity.gpsData?.endLatitude),
    nullIfUndefined(activity.gpsData?.endLongitude),
    totalGpsPoints,
    activity.gpsData?.hasPolyline || false,
    // Weather data
    nullIfUndefined(activity.weatherData?.temperature),
    nullIfUndefined(activity.weatherData?.apparentTemperature),
    nullIfUndefined(activity.weatherData?.humidity),
    nullIfUndefined(activity.weatherData?.dewPoint),
    nullIfUndefined(activity.weatherData?.windSpeed),
    nullIfUndefined(activity.weatherData?.windDirection),
    nullIfUndefined(activity.weatherData?.windDirectionCompass),
    nullIfUndefined(activity.weatherData?.windGust),
    nullIfUndefined(activity.weatherData?.weatherDescription),
    nullIfUndefined(activity.weatherData?.weatherStation),
    nullIfUndefined(activity.weatherData?.issueDate),
    activity.weatherData?.hasWeatherData || false,
    // Workout timing data
    nullIfUndefined(activity.workoutTiming?.totalWorkingTime),
    nullIfUndefined(activity.workoutTiming?.totalRestTime),
    nullIfUndefined(activity.workoutTiming?.workToRestRatio),
    nullIfUndefined(activity.workoutTiming?.workPercentage),
    nullIfUndefined(activity.createdAt), 
    nullIfUndefined(activity.updatedAt)
  ).run();
  
  // Store exercise sets for strength training
  if (activity.exerciseSets && activity.exerciseSets.length > 0) {
    console.log(`💪 Storing exercise sets for activity ${activity.id}:`, {
      exerciseCount: activity.exerciseSets.length,
      totalSetsToStore: activity.exerciseSets.reduce((total, exercise) => total + (exercise.sets ? exercise.sets.length : 0), 0)
    });
    
    // First, delete existing exercise sets for this activity
    await env.DATABASE.prepare(`DELETE FROM ${EXERCISE_SETS_TABLE} WHERE activity_id = ?`)
      .bind(activity.id).run();
    
    // Insert new exercise sets
    let totalInserted = 0;
    for (const exercise of activity.exerciseSets) {
      if (exercise.sets && Array.isArray(exercise.sets)) {
        for (let i = 0; i < exercise.sets.length; i++) {
          const set = exercise.sets[i];
          const setQuery = `
            INSERT INTO ${EXERCISE_SETS_TABLE}
            (activity_id, exercise_name, category, set_number, reps, weight, duration, start_time,
             total_working_time, total_reps, total_volume, total_sets, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          await env.DATABASE.prepare(setQuery).bind(
            nullIfUndefined(activity.id), 
            nullIfUndefined(exercise.exerciseName), 
            nullIfUndefined(exercise.category),
            i + 1, 
            nullIfUndefined(set.reps), 
            nullIfUndefined(set.weight), 
            nullIfUndefined(set.duration), 
            nullIfUndefined(set.startTime),
            nullIfUndefined(exercise.totalWorkingTime), 
            nullIfUndefined(exercise.totalReps), 
            nullIfUndefined(exercise.totalVolume), 
            nullIfUndefined(exercise.totalSets),
            nullIfUndefined(activity.createdAt)
          ).run();
          totalInserted++;
        }
      }
    }
    console.log(`✅ Inserted ${totalInserted} exercise sets for activity ${activity.id}`);
  } else if (activity.type === 'strength_training' || activity.type === 'strength') {
    console.log(`⚠️ Strength training activity ${activity.id} has no exercise sets data`);
  }
}

/**
 * Generate OAuth1 nonce (random string)
 */
function generateNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate OAuth1 signature using HMAC-SHA1
 */
async function generateOAuth1Signature(method, url, params, consumerSecret, tokenSecret = '') {
  // Create the base string
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');
  
  // Create the signing key
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  
  // Generate HMAC-SHA1 signature
  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingKey);
  const messageData = encoder.encode(baseString);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  
  // Convert to base64 with proper padding
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Signature = btoa(binary);
  
  return base64Signature;
}

/**
 * Handle bulk data import from browser export
 */
async function handleDataImport(request, env) {
  try {
    const importData = await request.json();
    
    if (!importData.activities || !Array.isArray(importData.activities)) {
      return new Response('Invalid data format', { status: 400 });
    }
    
    console.log(`📥 Importing ${importData.activities.length} activities...`);
    
    let imported = 0;
    let errors = 0;
    
    // Process in smaller batches to avoid limits
    const BATCH_SIZE = 10;
    const activities = importData.activities;
    
    for (let i = 0; i < activities.length; i += BATCH_SIZE) {
      const batch = activities.slice(i, i + BATCH_SIZE);
      
      for (const activity of batch) {
        try {
          await storeActivity(activity, env);
          imported++;
          
          if (imported % 50 === 0) {
            console.log(`📊 Progress: ${imported}/${activities.length} activities imported`);
          }
          
        } catch (error) {
          console.error(`❌ Failed to import activity ${activity.id}:`, error);
          errors++;
        }
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const result = {
      success: true,
      imported: imported,
      errors: errors,
      total: activities.length,
      timestamp: new Date().toISOString()
    };
    
    console.log(`✅ Import complete: ${imported} imported, ${errors} errors`);
    
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Import failed:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle request to get activities without GPS data
 */
async function handleGetActivitiesWithoutGPS(request, env) {
  try {
    console.log('📋 Fetching activities without GPS data...');

    // Query activities that don't have GPS data or have has_gps_data = false
    const query = `
      SELECT id, name, type, start_time, has_gps_data 
      FROM ${ACTIVITIES_TABLE} 
      WHERE has_gps_data = false OR has_gps_data IS NULL
      ORDER BY start_time DESC
      LIMIT 1000
    `;

    const result = await env.DATABASE.prepare(query).all();
    const activities = result.results || [];

    console.log(`📊 Found ${activities.length} activities without GPS data`);

    return new Response(JSON.stringify(activities), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });

  } catch (error) {
    console.error('❌ Error fetching activities without GPS:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Handle request to update GPS data for activities
 */
async function handleUpdateGPSData(request, env) {
  try {
    const body = await request.json();
    const activities = body.activities || [];

    if (!Array.isArray(activities) || activities.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No activities provided'
      }), { 
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    console.log(`📥 Updating GPS data for ${activities.length} activities...`);

    let updated = 0;
    let errors = 0;

    for (const activity of activities) {
      try {
        const { activityId, gpsData } = activity;

        // Prepare GPS data for storage
        let gpsPolyline = null;
        let totalGpsPoints = 0;
        
        if (gpsData.gpsPoints && gpsData.gpsPoints.length > 0) {
          gpsPolyline = JSON.stringify(gpsData.gpsPoints);
          totalGpsPoints = gpsData.gpsPoints.length;
        } else if (gpsData.polyline) {
          gpsPolyline = JSON.stringify(gpsData.polyline);
          totalGpsPoints = Array.isArray(gpsData.polyline) ? gpsData.polyline.length : 0;
        } else if (gpsData.totalGpsPoints) {
          totalGpsPoints = gpsData.totalGpsPoints;
        }

        // Update the activity with GPS data
        const updateQuery = `
          UPDATE ${ACTIVITIES_TABLE} 
          SET gps_polyline = ?,
              start_latitude = ?,
              start_longitude = ?,
              end_latitude = ?,
              end_longitude = ?,
              total_gps_points = ?,
              has_gps_data = ?,
              updated_at = ?
          WHERE id = ?
        `;

        await env.DATABASE.prepare(updateQuery).bind(
          gpsPolyline,
          gpsData.startLatitude,
          gpsData.startLongitude,
          gpsData.endLatitude,
          gpsData.endLongitude,
          totalGpsPoints,
          gpsData.hasPolyline,
          new Date().toISOString(),
          activityId
        ).run();

        updated++;
        console.log(`✅ Updated GPS data for activity ${activityId}`);

      } catch (error) {
        console.error(`❌ Error updating GPS data for activity ${activity.activityId}:`, error);
        errors++;
      }
    }

    console.log(`🎉 GPS update completed: ${updated} updated, ${errors} errors`);

    return new Response(JSON.stringify({
      success: true,
      updated: updated,
      errors: errors,
      message: `Updated GPS data for ${updated} activities${errors > 0 ? ` (${errors} errors)` : ''}`
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });

  } catch (error) {
    console.error('❌ Error handling GPS update request:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Handle request to update all activities (with and without GPS data)
 */
async function handleUpdateAllActivities(request, env) {
  try {
    const body = await request.json();
    const activities = body.activities || [];
    const batchSize = parseInt(body.batchSize) || 50; // Process in smaller batches
    const startIndex = parseInt(body.startIndex) || 0;

    if (!Array.isArray(activities) || activities.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No activities provided'
      }), { 
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Process only a batch of activities to avoid timeout
    const batch = activities.slice(startIndex, startIndex + batchSize);
    const totalActivities = activities.length;
    
    console.log(`📥 Processing batch ${Math.floor(startIndex / batchSize) + 1}: activities ${startIndex + 1}-${Math.min(startIndex + batchSize, totalActivities)} of ${totalActivities}`);

    let imported = 0;
    let errors = 0;
    const errorDetails = [];

    // Process activities in parallel for better performance (but with concurrency limit)
    const concurrencyLimit = 5;
    const results = [];
    
    for (let i = 0; i < batch.length; i += concurrencyLimit) {
      const chunk = batch.slice(i, i + concurrencyLimit);
      const chunkPromises = chunk.map(async (activity) => {
        try {
        const { activityId, activityData, gpsData, weatherData, exerciseSets, workoutTiming } = activity;

        // Log strength training data for debugging
        if (activityData.type === 'strength_training' || activityData.type === 'strength') {
          console.log(`💪 Processing strength training activity ${activityId}:`, {
            name: activityData.name,
            totalReps: activityData.totalReps,
            totalSets: activityData.totalSets,
            hasExerciseSets: !!(exerciseSets && exerciseSets.length > 0),
            hasWorkoutTiming: !!workoutTiming,
            exerciseSetCount: exerciseSets ? exerciseSets.length : 0,
            workoutTimingData: workoutTiming
          });
        }

        // Prepare the full activity object for storage
        const fullActivity = {
          id: activityId,
          name: activityData.name,
          type: activityData.type,
          startTime: activityData.startTime,
          duration: activityData.duration,
          movingTime: activityData.movingTime,
          calories: activityData.calories,
          averageHR: activityData.averageHR,
          maxHR: activityData.maxHR,
          distance: activityData.distance,
          averageSpeed: activityData.averageSpeed,
          maxSpeed: activityData.maxSpeed,
          elevationGain: activityData.elevationGain,
          elevationLoss: activityData.elevationLoss,
          // Include strength training fields
          totalReps: activityData.totalReps,
          totalSets: activityData.totalSets,
          // Include cycling/running fields
          averagePower: activityData.averagePower,
          maxPower: activityData.maxPower,
          normalizedPower: activityData.normalizedPower,
          trainingStressScore: activityData.trainingStressScore,
          averageCadence: activityData.averageCadence,
          maxCadence: activityData.maxCadence,
          createdAt: activityData.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          gpsData: gpsData,
          weatherData: weatherData,
          // Include strength training data
          exerciseSets: exerciseSets,
          workoutTiming: workoutTiming
        };

        // Store the complete activity
        await storeActivity(fullActivity, env);
        console.log(`✅ Imported activity ${activityId}: ${activityData.name || 'Unknown'}`);
        return { success: true, activityId };

        } catch (error) {
          console.error(`❌ Error importing activity ${activity.activityId}:`, error);
          return { success: false, activityId: activity.activityId, error: error.message };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    // Count results
    results.forEach(result => {
      if (result.success) {
        imported++;
      } else {
        errors++;
        errorDetails.push({ activityId: result.activityId, error: result.error });
      }
    });

    const isLastBatch = startIndex + batchSize >= totalActivities;
    const nextStartIndex = isLastBatch ? null : startIndex + batchSize;
    const progress = Math.round(((startIndex + batch.length) / totalActivities) * 100);

    console.log(`🎉 Batch completed: ${imported} imported, ${errors} errors. Progress: ${progress}%`);

    // Refresh stats and strength activities cache, and update sync time when the last batch is processed
    if (isLastBatch) {
      console.log('📊 Refreshing activity statistics cache...');
      await refreshActivityStats(env);
      console.log('📊 Refreshing strength activities cache...');
      await refreshStrengthActivitiesCache(env);
      // Update last sync time to the most recent activity date to prevent unnecessary syncs
      console.log('🕒 Updating last sync time after bulk upload...');
      let mostRecentDate = null;
      for (const activity of activities) {
        const activityDate = new Date(activity.activityData.startTime);
        if (!mostRecentDate || activityDate > mostRecentDate) {
          mostRecentDate = activityDate;
        }
      }
      const syncTime = mostRecentDate ? mostRecentDate.toISOString() : new Date().toISOString();
      console.log(`Setting lastSyncTime to: ${syncTime}`);
      await env.GARMIN_SYNC_KV.put('lastSyncTime', syncTime);
    }
/**
 * Handle strength activities endpoint with caching
 */


    return new Response(JSON.stringify({
      success: true,
      imported: imported,
      errors: errors,
      batchSize: batch.length,
      totalActivities: totalActivities,
      progress: progress,
      isComplete: isLastBatch,
      nextStartIndex: nextStartIndex,
      errorDetails: errorDetails.slice(0, 10), // Limit error details to prevent large responses
      message: `Batch processed: ${imported} imported, ${errors} errors. ${isLastBatch ? 'Upload complete!' : `Continue from index ${nextStartIndex}`}`
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('❌ Error processing batch:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Handle activity statistics endpoint
 */
async function handleGetActivityStats(request, env) {
  try {
    // Try to get cached stats first
    let stats = await env.GARMIN_SYNC_KV.get('activity_stats', { type: 'json' });
    
    if (!stats) {
      console.log('📊 No cached stats found, generating fresh statistics...');
      stats = await generateActivityStats(env);
      await env.GARMIN_SYNC_KV.put('activity_stats', JSON.stringify(stats));
    }
    
    return new Response(JSON.stringify({
      success: true,
      stats: stats,
      lastUpdated: stats.lastUpdated,
      cached: true
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });

  } catch (error) {
    console.error('❌ Error getting activity stats:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Generate comprehensive activity statistics
 */
async function generateActivityStats(env) {
  console.log('📊 Generating activity statistics...');

  // Main activity statistics query
  const statsQuery = `
    SELECT 
      COUNT(*) as total_count,
      SUM(COALESCE(duration, 0)) as total_time_seconds,
      SUM(COALESCE(distance, 0)) as total_distance,
      SUM(COALESCE(calories, 0)) as total_calories,
      SUM(COALESCE(elevation_gain, 0)) as total_elevation_gain,
      SUM(COALESCE(total_reps, 0)) as total_reps,
      SUM(COALESCE(total_sets, 0)) as total_sets,
      SUM(COALESCE(total_working_time, 0)) as total_working_time_seconds,
      MAX(COALESCE(temperature, -999)) as max_temperature,
      MIN(COALESCE(temperature, 999)) as min_temperature,
      MAX(COALESCE(wind_speed, 0)) as max_wind_speed,
      MAX(COALESCE(wind_gust, 0)) as max_wind_gust,
      COUNT(CASE WHEN has_gps_data = 1 THEN 1 END) as activities_with_gps,
      COUNT(CASE WHEN has_weather_data = 1 THEN 1 END) as activities_with_weather,
      COUNT(CASE WHEN type = 'strength_training' THEN 1 END) as strength_training_count,
      COUNT(CASE WHEN type = 'running' THEN 1 END) as running_count,
      COUNT(CASE WHEN type = 'cycling' THEN 1 END) as cycling_count
    FROM activities
  `;

  const result = await env.DATABASE.prepare(statsQuery).first();

  // Exercise sets count
  const exerciseSetsQuery = `SELECT COUNT(*) as total_exercise_sets FROM exercise_sets`;
  const exerciseSetsResult = await env.DATABASE.prepare(exerciseSetsQuery).first();

  // Activity type breakdown
  const typeBreakdownQuery = `
    SELECT type, COUNT(*) as count 
    FROM activities 
    GROUP BY type 
    ORDER BY count DESC
  `;
  const typeBreakdown = await env.DATABASE.prepare(typeBreakdownQuery).all();

  // Format time helper function
  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return { formatted: '0 seconds', hours: 0, minutes: 0, seconds: 0 };
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    let formatted = '';
    if (hours > 0) formatted += `${hours}h `;
    if (minutes > 0) formatted += `${minutes}m `;
    if (remainingSeconds > 0 || formatted === '') formatted += `${remainingSeconds}s`;
    
    return {
      formatted: formatted.trim(),
      hours,
      minutes,
      seconds: remainingSeconds
    };
  };

  // Handle edge cases for temperature
  let hottestTemp = result.max_temperature;
  let coldestTemp = result.min_temperature;
  
  if (hottestTemp === -999) hottestTemp = null;
  if (coldestTemp === 999) coldestTemp = null;

  const totalTime = formatDuration(result.total_time_seconds);
  const totalWorkingTime = formatDuration(result.total_working_time_seconds);

  const stats = {
    lastUpdated: new Date().toISOString(),
    
    // Main totals
    totalCount: result.total_count,
    totalTime: {
      seconds: result.total_time_seconds,
      formatted: totalTime.formatted,
      breakdown: {
        hours: totalTime.hours,
        minutes: totalTime.minutes,
        seconds: totalTime.seconds
      }
    },
    totalDistance: Math.round(result.total_distance * 100) / 100, // Round to 2 decimal places
    totalCalories: result.total_calories,
    totalElevationGain: Math.round(result.total_elevation_gain * 100) / 100,
    
    // Strength training
    totalReps: result.total_reps,
    totalSets: result.total_sets,
    totalExerciseSets: exerciseSetsResult.total_exercise_sets,
    totalWorkingTime: {
      seconds: result.total_working_time_seconds,
      formatted: totalWorkingTime.formatted,
      breakdown: {
        hours: totalWorkingTime.hours,
        minutes: totalWorkingTime.minutes,
        seconds: totalWorkingTime.seconds
      }
    },
    
    // Weather extremes
    hottestActivityTemp: hottestTemp,
    coldestActivityTemp: coldestTemp,
    highestWindSpeed: result.max_wind_speed,
    highestWindGust: result.max_wind_gust,
    
    // Data coverage
    activitiesWithGPS: result.activities_with_gps,
    activitiesWithWeather: result.activities_with_weather,
    
    // Activity breakdown
    activityTypeBreakdown: typeBreakdown.results.map(row => ({
      type: row.type,
      count: row.count,
      percentage: Math.round((row.count / result.total_count) * 100)
    })),
    
    // Popular activity counts
    strengthTrainingCount: result.strength_training_count,
    runningCount: result.running_count,
    cyclingCount: result.cycling_count
  };

  console.log('📊 Generated statistics:', {
    totalActivities: stats.totalCount,
    totalTime: stats.totalTime.formatted,
    strengthActivities: stats.strengthTrainingCount
  });

  return stats;
}

/**
 * Refresh activity statistics cache
 */
async function refreshActivityStats(env) {
  try {
    const stats = await generateActivityStats(env);
    await env.GARMIN_SYNC_KV.put('activity_stats', JSON.stringify(stats));
    console.log('📊 Activity statistics cache refreshed');
    return stats;
  } catch (error) {
    console.error('❌ Error refreshing activity stats:', error);
    throw error;
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
