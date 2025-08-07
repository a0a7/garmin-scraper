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

    // Fetch activities since last sync
    const activities = await fetchActivities(authData, lastSyncTime, isInitialSync);
    console.log(`Fetched ${activities.length} activities`);

    // Process and store activities
    const processedCount = await processAndStoreActivities(activities, authData, env);
    
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

// Export for testing
export {
  handleRequest,
  handleScheduled,
  syncGarminData,
  authenticateGarmin,
  fetchActivities,
  processActivityData
};
