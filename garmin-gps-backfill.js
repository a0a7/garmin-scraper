/**
 * Garmin GPS Data Backfill Script
 * 
 * This script runs in the browser console on connect.garmin.com to backfill GPS data
 * for activities that don't have GPS information yet.
 * 
 * Usage:
 * 1. Log into connect.garmin.com
 * 2. Open browser console (F12)
 * 3. Paste and run this script
 * 4. It will fetch GPS data for activities and upload to your worker
 */

/**
 * Garmin GPS Data Backfill Script
 * 
 * This script runs in the browser console on connect.garmin.com to backfill GPS data
 * for activities that don't have GPS information yet.
 * 
 * Usage:
 * 1. Log into connect.garmin.com
 * 2. Open browser console (F12)
 * 3. Update WORKER_URL below with your Cloudflare Worker URL
 * 4. Paste and run this script
 * 5. It will fetch GPS data for activities and upload to your worker
 */

(async function() {
  console.log('🗺️  Starting Garmin GPS Data Backfill...');
  
  // Configuration - UPDATE THIS VALUE WITH YOUR WORKER URL
  const WORKER_URL = 'https://your-worker-name.your-subdomain.workers.dev'; // ⚠️ UPDATE THIS!
  
  // Validate worker URL
  if (WORKER_URL.includes('your-worker-name') || WORKER_URL.includes('your-subdomain')) {
    console.error('❌ Please update WORKER_URL with your actual Cloudflare Worker URL!');
    console.log('The URL should look like: https://garmin-sync.your-subdomain.workers.dev');
    return;
  }
  
  const BATCH_SIZE = 10; // Process activities in batches
  const DELAY_BETWEEN_REQUESTS = 500; // ms delay between API calls
  const DELAY_BETWEEN_BATCHES = 2000; // ms delay between batches
  
  // Capture auth header from browser
  let authHeader = null;
  
  console.log('🔍 Looking for authorization header...');
  
  // Method 1: Try to intercept from a test request
  try {
    const testResponse = await fetch('https://connect.garmin.com/userprofile-service/profile', {
      method: 'GET',
      credentials: 'include'
    });
    
    // Check if we're logged in
    if (testResponse.status === 401) {
      console.error('❌ Not logged in to Garmin Connect. Please log in and try again.');
      return;
    }
    
    // Look for the authorization header in the request
    // This is tricky in browsers, so we'll use a different approach
  } catch (e) {
    console.log('Could not test login status');
  }
  
  // Method 2: Ask user to provide token manually
  console.log(`
� To get your authorization token:
1. Open Network tab in browser dev tools (F12 → Network)
2. Visit any activity page or refresh this page  
3. Look for any request to 'connect.garmin.com'
4. Click on the request → Headers → Request Headers
5. Find 'authorization: Bearer ...' and copy the Bearer token
6. Paste it when prompted below
  `);
  
  const userToken = prompt('Please paste your Bearer token (just the token part, not "Bearer"):');
  
  if (!userToken || !userToken.startsWith('eyJ')) {
    console.error('❌ Invalid or missing token. Token should start with "eyJ"');
    return;
  }
  
  authHeader = `Bearer ${userToken}`;
  console.log('✅ Authorization token set');
  
  // Get activities that need GPS data
  async function getActivitiesNeedingGPS() {
    console.log('📋 Fetching activities that need GPS data...');
    
    try {
      const response = await fetch(`${WORKER_URL}/activities-without-gps`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch activities: ${response.status} - ${errorText}`);
      }
      
      const activities = await response.json();
      console.log(`📊 Found ${activities.length} activities needing GPS data`);
      return activities;
      
    } catch (error) {
      console.error('❌ Error fetching activities from worker:', error);
      console.log('Make sure your worker is deployed and the URL is correct');
      throw error;
    }
  }
  
  // Fetch GPS details for a single activity
  async function fetchActivityGPS(activityId) {
    const url = `https://connect.garmin.com/activity-service/activity/${activityId}/details?maxChartSize=10000&maxPolylineSize=0&maxHeatMapSize=2000&_=${Date.now()}`;
    
    const headers = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Authorization': authHeader,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest'
    };
    
    try {
      const response = await fetch(url, { 
        headers,
        credentials: 'include'
      });
      
      if (response.status === 401 || response.status === 403) {
        throw new Error('Authentication failed - token may be expired');
      }
      
      if (!response.ok) {
        console.warn(`❌ Failed to fetch GPS for activity ${activityId}: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      
      // Extract GPS coordinates from activityDetailMetrics
      if (data.activityDetailMetrics && data.activityDetailMetrics.length > 0 && data.metricDescriptors) {
        // Find the indices for latitude and longitude in the metrics
        let latIndex = -1;
        let lonIndex = -1;
        let timestampIndex = -1;
        
        data.metricDescriptors.forEach((descriptor) => {
          if (descriptor.key === 'directLatitude') latIndex = descriptor.metricsIndex;
          if (descriptor.key === 'directLongitude') lonIndex = descriptor.metricsIndex;
          if (descriptor.key === 'directTimestamp') timestampIndex = descriptor.metricsIndex;
        });
        
        if (latIndex >= 0 && lonIndex >= 0) {
          // Extract GPS points
          const gpsPoints = [];
          
          data.activityDetailMetrics.forEach(metric => {
            const lat = metric.metrics[latIndex];
            const lon = metric.metrics[lonIndex];
            const timestamp = timestampIndex >= 0 ? metric.metrics[timestampIndex] : null;
            
            if (lat !== null && lon !== null && lat !== 0 && lon !== 0) {
              gpsPoints.push({ lat, lon, timestamp });
            }
          });
          
          if (gpsPoints.length > 0) {
            return {
              activityId: activityId,
              gpsData: {
                gpsPoints: gpsPoints,
                startLatitude: gpsPoints[0].lat,
                startLongitude: gpsPoints[0].lon,
                endLatitude: gpsPoints[gpsPoints.length - 1].lat,
                endLongitude: gpsPoints[gpsPoints.length - 1].lon,
                hasPolyline: true,
                totalGpsPoints: gpsPoints.length
              }
            };
          }
        }
      }
      
      // Check backup polyline method
      if (data.geoPolylineDTO && data.geoPolylineDTO.polyline && data.geoPolylineDTO.polyline.length > 0) {
        return {
          activityId: activityId,
          gpsData: {
            polyline: data.geoPolylineDTO.polyline,
            startLatitude: data.geoPolylineDTO.startPoint?.lat,
            startLongitude: data.geoPolylineDTO.startPoint?.lon,
            endLatitude: data.geoPolylineDTO.endPoint?.lat,
            endLongitude: data.geoPolylineDTO.endPoint?.lon,
            hasPolyline: true
          }
        };
      }
      
      console.log(`ℹ️  No GPS data found for activity ${activityId}`);
      return null;
      
    } catch (error) {
      console.error(`❌ Error fetching GPS for activity ${activityId}:`, error);
      
      if (error.message.includes('Authentication failed')) {
        throw error; // Re-throw auth errors to stop execution
      }
      
      return null;
    }
  }
  
  // Upload GPS data to worker
  async function uploadGPSData(gpsDataBatch) {
    try {
      const response = await fetch(`${WORKER_URL}/update-gps-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ activities: gpsDataBatch })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log(`✅ Uploaded GPS data for ${gpsDataBatch.length} activities`);
      return result;
      
    } catch (error) {
      console.error('❌ Error uploading GPS data:', error);
      throw error;
    }
  }
  
  // Main execution
  try {
    // Get activities that need GPS data
    const activities = await getActivitiesNeedingGPS();
    
    if (activities.length === 0) {
      console.log('🎉 All activities already have GPS data!');
      return;
    }
    
    console.log(`🚀 Starting GPS backfill for ${activities.length} activities...`);
    console.log('This may take a while. Check the console for progress updates.');
    
    let processed = 0;
    let successful = 0;
    let batch = [];
    
    for (const activity of activities) {
      console.log(`📍 Processing activity ${activity.id}: ${activity.name || 'Unknown'}`);
      
      // Fetch GPS data
      const gpsData = await fetchActivityGPS(activity.id);
      
      if (gpsData) {
        batch.push(gpsData);
        successful++;
        console.log(`✅ Got GPS data for ${activity.name || 'activity'} (${gpsData.gpsData.totalGpsPoints || 'polyline'} points)`);
      }
      
      processed++;
      
      // Process batch when full or at end
      if (batch.length >= BATCH_SIZE || processed === activities.length) {
        if (batch.length > 0) {
          console.log(`📤 Uploading batch of ${batch.length} activities...`);
          await uploadGPSData(batch);
          batch = [];
          
          // Delay between batches
          if (processed < activities.length) {
            console.log(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
          }
        }
      }
      
      // Delay between requests
      if (processed < activities.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
      
      // Progress update
      if (processed % 20 === 0 || processed === activities.length) {
        console.log(`📊 Progress: ${processed}/${activities.length} activities processed, ${successful} with GPS data found`);
      }
    }
    
    console.log('🎉 GPS backfill completed!');
    console.log(`📈 Final stats: ${processed} activities processed, ${successful} with GPS data added`);
    
  } catch (error) {
    console.error('❌ GPS backfill failed:', error);
    
    if (error.message.includes('401') || error.message.includes('403') || error.message.includes('Authentication failed')) {
      console.log('🔐 Authentication expired or invalid. Please refresh the page, get a new token, and try again.');
    }
  }
})();

console.log(`
🗺️  Garmin GPS Backfill Script Loaded!

⚠️  IMPORTANT: Update WORKER_URL in the script before running!

This script will:
1. 🔍 Find activities without GPS data  
2. 📡 Fetch GPS details from Garmin Connect
3. 📤 Upload GPS data to your worker
4. ✅ Update your database with GPS information

The script processes activities in batches to avoid rate limiting.
You'll need to provide your Bearer token when prompted.
`);
  
  // Get activities that need GPS data
  async function getActivitiesNeedingGPS() {
    console.log('📋 Fetching activities that need GPS data...');
    
    const response = await fetch(`${WORKER_URL}/activities-without-gps`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch activities: ${response.status}`);
    }
    
    const activities = await response.json();
    console.log(`📊 Found ${activities.length} activities needing GPS data`);
    return activities;
  }
  
  // Fetch GPS details for a single activity
  async function fetchActivityGPS(activityId) {
    const url = `https://connect.garmin.com/activity-service/activity/${activityId}/details?maxChartSize=10000&maxPolylineSize=0&maxHeatMapSize=2000&_=${Date.now()}`;
    
    const headers = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Authorization': authHeader,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest'
    };
    
    try {
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        console.warn(`❌ Failed to fetch GPS for activity ${activityId}: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      
      // Extract GPS coordinates from activityDetailMetrics
      if (data.activityDetailMetrics && data.activityDetailMetrics.length > 0 && data.metricDescriptors) {
        // Find the indices for latitude and longitude in the metrics
        let latIndex = -1;
        let lonIndex = -1;
        let timestampIndex = -1;
        
        data.metricDescriptors.forEach((descriptor, index) => {
          if (descriptor.key === 'directLatitude') latIndex = descriptor.metricsIndex;
          if (descriptor.key === 'directLongitude') lonIndex = descriptor.metricsIndex;
          if (descriptor.key === 'directTimestamp') timestampIndex = descriptor.metricsIndex;
        });
        
        if (latIndex >= 0 && lonIndex >= 0) {
          // Extract GPS points
          const gpsPoints = [];
          
          data.activityDetailMetrics.forEach(metric => {
            const lat = metric.metrics[latIndex];
            const lon = metric.metrics[lonIndex];
            const timestamp = timestampIndex >= 0 ? metric.metrics[timestampIndex] : null;
            
            if (lat !== null && lon !== null && lat !== 0 && lon !== 0) {
              gpsPoints.push({ lat, lon, timestamp });
            }
          });
          
          if (gpsPoints.length > 0) {
            return {
              activityId: activityId,
              gpsData: {
                gpsPoints: gpsPoints,
                startLatitude: gpsPoints[0].lat,
                startLongitude: gpsPoints[0].lon,
                endLatitude: gpsPoints[gpsPoints.length - 1].lat,
                endLongitude: gpsPoints[gpsPoints.length - 1].lon,
                hasPolyline: true,
                totalGpsPoints: gpsPoints.length
              }
            };
          }
        }
      }
      
      // Check backup polyline method
      if (data.geoPolylineDTO && data.geoPolylineDTO.polyline && data.geoPolylineDTO.polyline.length > 0) {
        return {
          activityId: activityId,
          gpsData: {
            polyline: data.geoPolylineDTO.polyline,
            startLatitude: data.geoPolylineDTO.startPoint?.lat,
            startLongitude: data.geoPolylineDTO.startPoint?.lon,
            endLatitude: data.geoPolylineDTO.endPoint?.lat,
            endLongitude: data.geoPolylineDTO.endPoint?.lon,
            hasPolyline: true
          }
        };
      }
      
      console.log(`ℹ️  No GPS data found for activity ${activityId}`);
      return null;
      
    } catch (error) {
      console.error(`❌ Error fetching GPS for activity ${activityId}:`, error);
      return null;
    }
  }
  
  // Upload GPS data to worker
  async function uploadGPSData(gpsDataBatch) {
    try {
      const response = await fetch(`${WORKER_URL}/update-gps-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ activities: gpsDataBatch })
      });
      
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }
      
      const result = await response.json();
      console.log(`✅ Uploaded GPS data for ${gpsDataBatch.length} activities`);
      return result;
      
    } catch (error) {
      console.error('❌ Error uploading GPS data:', error);
      throw error;
    }
  }
  
  // Main execution
  try {
    // Get activities that need GPS data
    const activities = await getActivitiesNeedingGPS();
    
    if (activities.length === 0) {
      console.log('🎉 All activities already have GPS data!');
      return;
    }
    
    console.log(`🚀 Starting GPS backfill for ${activities.length} activities...`);
    
    let processed = 0;
    let successful = 0;
    let batch = [];
    
    for (const activity of activities) {
      console.log(`📍 Processing activity ${activity.id}: ${activity.name}`);
      
      // Fetch GPS data
      const gpsData = await fetchActivityGPS(activity.id);
      
      if (gpsData) {
        batch.push(gpsData);
        successful++;
        console.log(`✅ Got GPS data for ${activity.name} (${gpsData.gpsData.totalGpsPoints || 'polyline'} points)`);
      }
      
      processed++;
      
      // Process batch when full or at end
      if (batch.length >= BATCH_SIZE || processed === activities.length) {
        if (batch.length > 0) {
          console.log(`📤 Uploading batch of ${batch.length} activities...`);
          await uploadGPSData(batch);
          batch = [];
          
          // Delay between batches
          if (processed < activities.length) {
            console.log(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
          }
        }
      }
      
      // Delay between requests
      if (processed < activities.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
      
      // Progress update
      if (processed % 20 === 0 || processed === activities.length) {
        console.log(`📊 Progress: ${processed}/${activities.length} activities processed, ${successful} with GPS data found`);
      }
    }
    
    console.log('🎉 GPS backfill completed!');
    console.log(`📈 Final stats: ${processed} activities processed, ${successful} with GPS data added`);
    
  } catch (error) {
    console.error('❌ GPS backfill failed:', error);
    
    if (error.message.includes('401') || error.message.includes('403')) {
      console.log('🔐 Authentication may have expired. Please refresh the page and try again.');
    }
  }
})();

console.log(`
📋 Garmin GPS Backfill Script Loaded!

⚠️  IMPORTANT: Before running, update WORKER_URL in the script!

This script will:
1. 🔍 Find activities without GPS data
2. 📡 Fetch GPS details from Garmin Connect
3. 📤 Upload GPS data to your worker
4. ✅ Update your database with GPS information

The script processes activities in batches to avoid rate limiting.
Check the console for progress updates.
`);
