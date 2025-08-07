/**
 * Garmin GPS Data Backfill Script for JSON File
 * 
 * This script runs in the browser console on connect.garmin.com to:
 * 1. Read your existing JSON file of activities
 * 2. Add GPS data to activities that don't have it
 * 3. Save the enriched data to a new JSON file
 * 
 * Usage:
 * 1. Log into connect.garmin.com
 * 2. Open browser console (F12)
 * 3. P      if (gpsData) {
        // Find the activity in the original data and update it
        const activityIndex = activityMap.get(activity.activityId);
        if (activityIndex !== undefined) {
          // Update the gpsData structure to match the JSON format
          activitiesData[activityIndex].gpsData = {
            hasPolyline: true,
            ...gpsData
          };
          
          // Also set the top-level hasPolyline for backward compatibility
          activitiesData[activityIndex].hasPolyline = true;
          
          successful++;
          console.log(`✅ Added GPS data to ${activity.activityName || 'activity'} (${gpsData.totalGpsPoints || 'polyline'} points)`);
        }
      } else {this script
 * 4. It will prompt you to upload your JSON file
 * 5. It will fetch GPS data and create a downloadable enriched file
 */

(async function() {
  console.log('🗺️  Starting Garmin GPS Data Backfill for JSON File...');
  
  const BATCH_SIZE = 10; // Process activities in batches
  const DELAY_BETWEEN_REQUESTS = 50; // ms delay between API calls
  const DELAY_BETWEEN_BATCHES = 100; // ms delay between batches
  
  // Capture auth header from browser
  let authHeader = null;
  let activitiesData = null;
  
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
    
  } catch (e) {
    console.log('Could not test login status');
  }
  
  // Method 2: Ask user to provide token manually
  console.log(`
🔐 To get your authorization token:
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
  
  // Function to create drag-and-drop area for file loading
  function createDragDropArea() {
    return new Promise((resolve, reject) => {
      // Create drag-drop area
      const dropArea = document.createElement('div');
      dropArea.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 400px;
        height: 200px;
        border: 3px dashed #007acc;
        border-radius: 10px;
        background: rgba(0, 122, 204, 0.1);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        font-size: 16px;
        color: #007acc;
        z-index: 10000;
        cursor: pointer;
      `;
      
      dropArea.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 48px; margin-bottom: 10px;">📂</div>
          <div style="font-weight: bold; margin-bottom: 10px;">Drop your JSON file here</div>
          <div style="font-size: 14px; opacity: 0.8;">or click to browse</div>
          <div style="font-size: 12px; margin-top: 10px; opacity: 0.6;">Looking for: garmin-activities-complete-*.json</div>
        </div>
      `;
      
      document.body.appendChild(dropArea);
      
      // Handle drag events
      dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.style.background = 'rgba(0, 122, 204, 0.2)';
        dropArea.style.borderColor = '#0066cc';
      });
      
      dropArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropArea.style.background = 'rgba(0, 122, 204, 0.1)';
        dropArea.style.borderColor = '#007acc';
      });
      
      dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          handleFile(files[0]);
        }
      });
      
      // Handle click to browse
      dropArea.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
          if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
          }
        };
        input.click();
      });
      
      function handleFile(file) {
        console.log(`📂 Processing file: ${file.name}`);
        dropArea.innerHTML = `
          <div style="text-align: center;">
            <div style="font-size: 32px; margin-bottom: 10px;">⏳</div>
            <div>Loading ${file.name}...</div>
            <div style="font-size: 12px; margin-top: 5px;">This may take a moment</div>
          </div>
        `;
        
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            console.log(`✅ Successfully loaded ${data.length} activities from ${file.name}`);
            document.body.removeChild(dropArea);
            resolve(data);
          } catch (error) {
            console.error('❌ Failed to parse JSON:', error);
            dropArea.innerHTML = `
              <div style="text-align: center; color: #cc0000;">
                <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
                <div>Error parsing JSON</div>
                <div style="font-size: 12px; margin-top: 5px;">Click to try again</div>
              </div>
            `;
            setTimeout(() => {
              dropArea.innerHTML = `
                <div style="text-align: center;">
                  <div style="font-size: 48px; margin-bottom: 10px;">📂</div>
                  <div style="font-weight: bold; margin-bottom: 10px;">Drop your JSON file here</div>
                  <div style="font-size: 14px; opacity: 0.8;">or click to browse</div>
                </div>
              `;
            }, 2000);
          }
        };
        reader.onerror = () => {
          console.error('❌ Failed to read file');
          reject(new Error('Failed to read file'));
        };
        reader.readAsText(file);
      }
    });
  }
  
  // Function to download JSON file
  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  // Load the existing JSON file
  console.log('📂 Ready to load your Garmin activities JSON file...');
  console.log('💡 A drag-and-drop area will appear on your screen');
  try {
    const rawData = await createDragDropArea();
    
    // Debug: Check the structure of the loaded data
    console.log('🔍 Analyzing JSON structure...');
    console.log('Type:', typeof rawData);
    console.log('Is Array:', Array.isArray(rawData));
    
    if (rawData && typeof rawData === 'object') {
      console.log('Keys:', Object.keys(rawData));
    }
    
    // Handle different JSON structures
    let activitiesArray;
    if (Array.isArray(rawData)) {
      // Direct array of activities
      activitiesArray = rawData;
    } else if (rawData && rawData.activities && Array.isArray(rawData.activities)) {
      // Object with activities property
      activitiesArray = rawData.activities;
    } else if (rawData && typeof rawData === 'object') {
      // Check for other possible array properties
      const arrayKeys = Object.keys(rawData).filter(key => Array.isArray(rawData[key]));
      if (arrayKeys.length > 0) {
        console.log(`🔍 Found array properties: ${arrayKeys.join(', ')}`);
        activitiesArray = rawData[arrayKeys[0]]; // Use first array found
      } else {
        throw new Error('No array of activities found in JSON file');
      }
    } else {
      throw new Error('Invalid JSON structure - expected array or object with activities');
    }
    
    activitiesData = activitiesArray;
    console.log(`📊 Loaded ${activitiesData.length} activities from JSON file`);
  } catch (error) {
    console.error('❌ Error loading JSON file:', error);
    return;
  }
  
  // Filter activities that need GPS data
  const activitiesNeedingGPS = activitiesData.filter(activity => {
    // Check if activity has no GPS data or hasPolyline is false
    return !activity.gpsData || 
           !activity.gpsData.hasPolyline || 
           activity.gpsData.hasPolyline === false ||
           !activity.hasPolyline || 
           activity.hasPolyline === false;
  });
  
  console.log(`🔍 Found ${activitiesNeedingGPS.length} activities that need GPS data`);
  
  if (activitiesNeedingGPS.length === 0) {
    console.log('🎉 All activities already have GPS data!');
    return;
  }
  
  // Fetch GPS details for a single activity
  async function fetchActivityGPS(activityId) {
    const url = `https://connect.garmin.com/activity-service/activity/${activityId}/polyline/full-resolution/?_=${Date.now()}`;
    
    const headers = {
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'accept-language': 'en-US,en;q=0.9',
      'authorization': authHeader,
      'cache-control': 'no-cache',
      'di-backend': 'connectapi.garmin.com',
      'nk': 'NT',
      'pragma': 'no-cache',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'x-requested-with': 'XMLHttpRequest'
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
  
  // Main execution
  try {
    console.log(`🚀 Starting GPS backfill for ${activitiesNeedingGPS.length} activities...`);
    console.log('This may take a while. Check the console for progress updates.');
    
    let processed = 0;
    let successful = 0;
    
    // Create a map of activity IDs for quick lookup
    const activityMap = new Map();
    activitiesData.forEach((activity, index) => {
      // Handle both 'id' and 'activityId' properties
      const activityId = activity.id || activity.activityId;
      if (activityId) {
        activityMap.set(activityId, index);
      }
    });
    
    for (const activity of activitiesNeedingGPS) {
      const activityId = activity.id || activity.activityId;
      const activityName = activity.name || activity.activityName || 'Unknown';
        const activityType = activity.type || 'Unknown';

      console.log(`📍 Processing activity ${activityId}: ${activityName}`);
      
      // Fetch GPS data
      if (activityType !== "strength_training") {
        const gpsData = await fetchActivityGPS(activityId);
        if (gpsData) {
            // Find the activity in the original data and update it
            const activityIndex = activityMap.get(activityId);
            if (activityIndex !== undefined) {
            // Update the gpsData structure to match the JSON format
            activitiesData[activityIndex].gpsData = {
                hasPolyline: true,
                ...gpsData
            };
            
            // Also set the top-level hasPolyline for backward compatibility
            activitiesData[activityIndex].hasPolyline = true;
            
            successful++;
            console.log(`✅ Added GPS data to ${activityName} (${gpsData.totalGpsPoints || 'polyline'} points)`);
            }
        } else {
            console.log(`⚠️ No GPS data found for ${activityName}`);
        }
        } else {
            console.log(`Skipping GPS fetch for strength training activity ${activityName}`);
        }
      
      processed++;
      
      // Progress update
      if (processed % 20 === 0 || processed === activitiesNeedingGPS.length) {
        console.log(`📊 Progress: ${processed}/${activitiesNeedingGPS.length} activities processed, ${successful} with GPS data added`);
      }
      
      // Delay between requests
      if (processed < activitiesNeedingGPS.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
      
      // Batch delay
      if (processed % BATCH_SIZE === 0 && processed < activitiesNeedingGPS.length) {
        console.log(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
    console.log('🎉 GPS backfill completed!');
    console.log(`📈 Final stats: ${processed} activities processed, ${successful} with GPS data added`);
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `garmin-activities-with-gps-${timestamp}.json`;
    
    // Download the enriched data
    console.log(`💾 Downloading enriched data as ${filename}...`);
    downloadJSON(activitiesData, filename);
    
    console.log('✅ File downloaded! You can now use this enriched JSON file with GPS data.');
    
  } catch (error) {
    console.error('❌ GPS backfill failed:', error);
    
    if (error.message.includes('401') || error.message.includes('403') || error.message.includes('Authentication failed')) {
      console.log('🔐 Authentication expired or invalid. Please refresh the page, get a new token, and try again.');
    }
  }
})();

console.log(`
🗺️  Garmin GPS Backfill Script for JSON File Loaded!

This script will:
1. 📂 Ask you to select your existing JSON file
2. 🔍 Find activities without GPS data  
3. 📡 Fetch GPS details from Garmin Connect
4. 💾 Download an enriched JSON file with GPS data

You'll need to provide your Bearer token when prompted.
The enriched file will be automatically downloaded when complete.
`);
