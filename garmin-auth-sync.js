/**
 * Garmin Connect Auth Header Extractor + Data Sync
 * This script captures the auth header and then fetches all your data
 * Run this in two steps on connect.garmin.com
 */

// Step 1: Set up auth header capture
console.log('🔑 Setting up auth header capture...');

let authHeader = null;

// Step 1: Set up auth header capture
console.log('🔑 Setting up auth header capture...');

// Intercept fetch requests to capture auth header
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const options = args[1] || {};
  
  // Capture authorization headers from outgoing requests
  if (options.headers) {
    if (options.headers.Authorization && options.headers.Authorization.startsWith('Bearer')) {
      authHeader = options.headers.Authorization;
      console.log('✅ Captured auth header from fetch!');
    }
    // Also check if headers is a Headers object
    if (options.headers instanceof Headers) {
      const auth = options.headers.get('Authorization');
      if (auth && auth.startsWith('Bearer')) {
        authHeader = auth;
        console.log('✅ Captured auth header from Headers object!');
      }
    }
  }
  
  return originalFetch.apply(this, args).then(response => {
    // Try to capture from response headers too (though this is less likely)
    const auth = response.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer')) {
      authHeader = auth;
      console.log('✅ Captured auth header from response!');
    }
    return response;
  });
};

// Also try to intercept XMLHttpRequests
const originalXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(body) {
  // Check if authorization header is set
  const authValue = this.getRequestHeader && this.getRequestHeader('Authorization');
  if (authValue && authValue.startsWith('Bearer')) {
    authHeader = authValue;
    console.log('✅ Captured auth header from XHR!');
  }
  return originalXHRSend.apply(this, arguments);
};

console.log('✅ Auth capture set up');
console.log('💡 Now navigate around Garmin Connect (refresh page, view activities, etc.)');
console.log('💡 Then run: startDataExtraction()');

// Step 2: Data extraction function
window.startDataExtraction = async function() {
  if (!authHeader) {
    console.log('❌ No auth header captured yet. Please navigate around the site first.');
    return;
  }
  
  console.log('🚀 Starting Garmin Connect data extraction...');
  
  const activities = [];
  const PAGE_SIZE = 20;
  let start = 0;
  let hasMore = true;
  let totalFetched = 0;
  
  const startTime = Date.now();
  
  async function fetchActivitiesList(pageSize, startIndex) {
    const url = `https://connect.garmin.com/activitylist-service/activities/search/activities?limit=${pageSize}&start=${startIndex}`;
    
    console.log('🔍 Making request with auth header:', authHeader.substring(0, 20) + '...');
    
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-GB,en;q=0.5",
        "NK": "NT",
        "X-lang": "en-US",
        "DI-Backend": "connectapi.garmin.com",
        "Authorization": authHeader,
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-origin",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
      },
      referrer: "https://connect.garmin.com/modern/activities",
      method: "GET",
      mode: "cors",
    });
    
    if (!response.ok) {
      console.error('Request failed with status:', response.status);
      console.error('Response headers:', [...response.headers.entries()]);
      const errorText = await response.text().catch(() => 'No error text');
      console.error('Error response:', errorText);
      throw new Error(`Failed to fetch activities: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  async function fetchActivityExerciseSets(activityId) {
    const url = `https://connect.garmin.com/activity-service/activity/${activityId}/exerciseSets`;
    
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-GB,en;q=0.5",
          NK: "NT",
          "X-lang": "en-US",
          "DI-Backend": "connectapi.garmin.com",
          Authorization: authHeader,
          "X-Requested-With": "XMLHttpRequest",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "no-cors",
          "Sec-Fetch-Site": "same-origin",
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
        },
        referrer: "https://connect.garmin.com/modern/activities",
        method: "GET",
        mode: "cors",
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.exerciseSets || [];
      }
      return [];
    } catch (error) {
      console.warn(`⚠️ Failed to fetch exercise sets for ${activityId}:`, error);
      return [];
    }
  }
  
  async function fetchActivityRouteData(activityId) {
    const url = `https://connect.garmin.com/activity-service/activity/${activityId}`;
    
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-GB,en;q=0.5",
          NK: "NT",
          "X-lang": "en-US",
          "DI-Backend": "connectapi.garmin.com",
          Authorization: authHeader,
          "X-Requested-With": "XMLHttpRequest",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "no-cors",
          "Sec-Fetch-Site": "same-origin",
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
        },
        referrer: "https://connect.garmin.com/modern/activities",
        method: "GET",
        mode: "cors",
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.geoPolylineDTO && data.geoPolylineDTO.polyline) {
          return {
            polyline: data.geoPolylineDTO.polyline,
            startLatitude: data.geoPolylineDTO.startLatitude,
            startLongitude: data.geoPolylineDTO.startLongitude,
            endLatitude: data.geoPolylineDTO.endLatitude,
            endLongitude: data.geoPolylineDTO.endLongitude,
            hasPolyline: true
          };
        }
      }
      return { hasPolyline: false };
    } catch (error) {
      console.warn(`⚠️ Failed to fetch route data for ${activityId}:`, error);
      return { hasPolyline: false };
    }
  }

  async function fetchActivityWeatherData(activityId) {
    const url = `https://connect.garmin.com/activity-service/activity/${activityId}/weather?_=${Date.now()}`;
    
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.9",
          NK: "NT",
          "X-lang": "en-US",
          "DI-Backend": "connectapi.garmin.com",
          Authorization: authHeader,
          "X-Requested-With": "XMLHttpRequest",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
        },
        referrer: "https://connect.garmin.com/modern/activities",
        method: "GET",
        mode: "cors",
      });
      
      if (response.ok) {
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
      }
      return { hasWeatherData: false };
    } catch (error) {
      console.warn(`⚠️ Failed to fetch weather data for ${activityId}:`, error);
      return { hasWeatherData: false };
    }
  }
  
  // Main extraction loop
  while (hasMore) {
    try {
      console.log(`📥 Fetching activities ${start + 1}-${start + PAGE_SIZE}...`);
      
      const batch = await fetchActivitiesList(PAGE_SIZE, start);
      
      if (!Array.isArray(batch) || batch.length === 0) {
        console.log('✅ No more activities found');
        hasMore = false;
        break;
      }
      
      // Process each activity in the batch
      for (const activity of batch) {
        const processedActivity = {
          id: activity.activityId,
          name: activity.activityName || '',
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
          averagePower: activity.avgPower,
          maxPower: activity.maxPower,
          normalizedPower: activity.normalizedPower,
          trainingStressScore: activity.trainingStressScore,
          averageCadence: activity.avgRunCadence || activity.avgBikeCadence,
          maxCadence: activity.maxRunCadence || activity.maxBikeCadence,
          totalReps: activity.totalReps,
          totalSets: activity.totalSets,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        // For activities with GPS data, fetch route coordinates
        if (activity.distance && activity.distance > 0 && ['running', 'cycling', 'walking', 'hiking', 'mountain_biking'].includes(activity.activityType?.typeKey)) {
          console.log(`🗺️ Fetching GPS route for ${activity.activityType?.typeKey}: ${activity.activityName}`);
          processedActivity.gpsData = await fetchActivityRouteData(activity.activityId);
          if (processedActivity.gpsData.hasPolyline) {
            console.log(`✅ Fetched GPS polyline data (${processedActivity.gpsData.polyline.length} chars)`);
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // For outdoor activities, fetch weather data
        const outdoorActivities = ['running', 'cycling', 'walking', 'hiking', 'mountain_biking', 'road_biking', 'trail_running'];
        if (outdoorActivities.includes(activity.activityType?.typeKey)) {
          console.log(`🌤️ Fetching weather data for ${activity.activityType?.typeKey}: ${activity.activityName}`);
          processedActivity.weatherData = await fetchActivityWeatherData(activity.activityId);
          if (processedActivity.weatherData.hasWeatherData) {
            console.log(`✅ Weather: ${processedActivity.weatherData.temperature}°F, ${processedActivity.weatherData.weatherDescription}`);
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        // For strength training activities, fetch exercise sets
        if (activity.activityType?.typeKey === 'strength_training') {
          console.log(`💪 Fetching exercise sets for strength training: ${activity.activityName}`);
          const exerciseSets = await fetchActivityExerciseSets(activity.activityId);
          
          if (exerciseSets.length > 0) {
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
            processedActivity.exerciseSets = Object.values(exerciseGroups).map(exercise => ({
              ...exercise,
              totalReps: exercise.sets.reduce((sum, set) => sum + (set.reps || 0), 0),
              totalVolume: exercise.sets.reduce((sum, set) => sum + ((set.reps || 0) * (set.weight || 0)), 0),
              totalSets: exercise.sets.length,
              totalWorkingTime: Math.round(exercise.totalWorkingTime) // seconds
            }));
            
            // Add workout timing summary to the activity
            processedActivity.workoutTiming = {
              totalWorkingTime: Math.round(totalWorkingTime), // seconds
              totalRestTime: Math.round(totalRestTime), // seconds
              totalTime: Math.round(totalWorkingTime + totalRestTime), // seconds
              workToRestRatio: totalRestTime > 0 ? Math.round((totalWorkingTime / totalRestTime) * 100) / 100 : null,
              workPercentage: totalWorkingTime + totalRestTime > 0 ? Math.round((totalWorkingTime / (totalWorkingTime + totalRestTime)) * 100) : 0
            };
            
            const totalSets = processedActivity.exerciseSets.reduce((total, ex) => total + ex.sets.length, 0);
            const workMinutes = Math.round(totalWorkingTime / 60);
            const restMinutes = Math.round(totalRestTime / 60);
            console.log(`✅ Fetched ${processedActivity.exerciseSets.length} exercise types with ${totalSets} total sets`);
            console.log(`⏱️ Work: ${workMinutes}m, Rest: ${restMinutes}m (${processedActivity.workoutTiming.workPercentage}% working)`);
          }
          
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        activities.push(processedActivity);
        totalFetched++;
      }
      
      console.log(`📊 Progress: ${totalFetched} activities fetched (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      
      start += PAGE_SIZE;
      
      if (batch.length < PAGE_SIZE) {
        hasMore = false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (totalFetched > 5000) {
        console.log('⚠️ Reached safety limit of 5000 activities');
        break;
      }
      
    } catch (error) {
      console.error(`❌ Error fetching activities at start=${start}:`, error);
      break;
    }
  }
  
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);
  
  console.log(`✅ Extraction complete!`);
  console.log(`📊 Total activities: ${activities.length}`);
  console.log(`💪 Strength training activities: ${activities.filter(a => a.type === 'strength_training').length}`);
  console.log(`🏃 Cardio activities: ${activities.filter(a => ['running', 'cycling', 'walking'].includes(a.type)).length}`);
  console.log(`🗺️ Activities with GPS data: ${activities.filter(a => a.gpsData && a.gpsData.hasPolyline).length}`);
  console.log(`🌤️ Activities with weather data: ${activities.filter(a => a.weatherData && a.weatherData.hasWeatherData).length}`);
  console.log(`⏱️ Time taken: ${duration}s`);
  
  // Create downloadable JSON file
  const dataStr = JSON.stringify({
    exportDate: new Date().toISOString(),
    totalActivities: activities.length,
    activities: activities
  }, null, 2);
  
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `garmin-activities-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  console.log('📁 Data exported to JSON file - check your downloads!');
  
  // Also make data available in console
  window.garminExportedData = {
    exportDate: new Date().toISOString(),
    totalActivities: activities.length,
    activities: activities
  };
  
  console.log('💾 Data also saved to window.garminExportedData for inspection');
  
  return activities;
};

console.log('📝 Setup complete! Instructions:');
console.log('1. Refresh this page or navigate to view some activities');
console.log('2. Then run: startDataExtraction()');
