/**
 * Garmin Activities Upload Script
 * 
 * This script uploads your complete JSON file with activity data to your Cloudflare Worker
 * 
 * Usage:
 * 1. Make sure your Cloudflare Worker is deployed and accessible
 * 2. Open browser console on any page
 * 3. Paste and run this script
 * 4. Drop your activities JSON file when prompted
 * 5. The script will upload all activities (with and without GPS data) to your worker's database
 */

(async function() {
  console.log('📤 Garmin GPS Data Upload Script Started...');
  
  // Configuration - UPDATE THESE URLs
  const WORKER_BASE_URL = 'https://garmin-sync-worker.lev-s-cloudflare.workers.dev'; // UPDATE THIS
  
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
        width: 500px;
        height: 250px;
        border: 3px dashed #28a745;
        border-radius: 10px;
        background: rgba(40, 167, 69, 0.1);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        font-size: 16px;
        color: #28a745;
        z-index: 10000;
        cursor: pointer;
      `;
      
      dropArea.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 48px; margin-bottom: 10px;">📤</div>
          <div style="font-weight: bold; margin-bottom: 10px;">Drop your GPS-enriched JSON file here</div>
          <div style="font-size: 14px; opacity: 0.8;">or click to browse</div>
          <div style="font-size: 12px; margin-top: 10px; opacity: 0.6;">Looking for: garmin-activities-with-gps-*.json</div>
          <div style="font-size: 11px; margin-top: 5px; opacity: 0.5;">Will upload GPS data to Cloudflare Worker</div>
        </div>
      `;
      
      document.body.appendChild(dropArea);
      
      // Handle drag events
      dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.style.background = 'rgba(40, 167, 69, 0.2)';
        dropArea.style.borderColor = '#1e7e34';
      });
      
      dropArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropArea.style.background = 'rgba(40, 167, 69, 0.1)';
        dropArea.style.borderColor = '#28a745';
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
            <div style="font-size: 12px; margin-top: 5px;">Analyzing GPS data...</div>
          </div>
        `;
        
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            let activities;
            
            // Handle different JSON structures
            if (Array.isArray(data)) {
              activities = data;
            } else if (data.activities && Array.isArray(data.activities)) {
              activities = data.activities;
            } else {
              throw new Error('Invalid JSON structure');
            }
            
            // Filter activities - include both with and without GPS data
            const allActivities = activities.map(activity => ({
              id: activity.id,
              name: activity.name,
              type: activity.type,
              startTime: activity.startTime,
              duration: activity.duration,
              movingTime: activity.movingTime,
              calories: activity.calories,
              averageHR: activity.averageHR,
              maxHR: activity.maxHR,
              distance: activity.distance,
              averageSpeed: activity.averageSpeed,
              maxSpeed: activity.maxSpeed,
              elevationGain: activity.elevationGain,
              elevationLoss: activity.elevationLoss,
              gpsData: activity.gpsData,
              weatherData: activity.weatherData,
              // Include strength training data
              exerciseSets: activity.exerciseSets,
              workoutTiming: activity.workoutTiming,
              totalReps: activity.totalReps,
              totalSets: activity.totalSets,
              // Include other fields that might be missing
              averagePower: activity.averagePower,
              maxPower: activity.maxPower,
              normalizedPower: activity.normalizedPower,
              trainingStressScore: activity.trainingStressScore,
              averageCadence: activity.averageCadence,
              maxCadence: activity.maxCadence,
              createdAt: activity.createdAt,
              updatedAt: activity.updatedAt
            }));
            
            const activitiesWithGPS = allActivities.filter(activity => 
              activity.gpsData && 
              activity.gpsData.hasPolyline && 
              (activity.gpsData.gpsPoints || activity.gpsData.polyline)
            );
            
            const activitiesWithoutGPS = allActivities.filter(activity => 
              !activity.gpsData || 
              !activity.gpsData.hasPolyline
            );
            
            // Count strength training activities for logging
            const strengthActivities = allActivities.filter(activity => 
              activity.type === 'strength_training' || activity.type === 'strength'
            );
            
            const strengthWithSets = strengthActivities.filter(activity => 
              activity.exerciseSets && activity.exerciseSets.length > 0
            );
            
            console.log(`📊 Found ${activitiesWithGPS.length} activities with GPS data and ${activitiesWithoutGPS.length} without GPS data out of ${activities.length} total`);
            console.log(`💪 Found ${strengthActivities.length} strength training activities, ${strengthWithSets.length} with exercise sets data`);
            
            // Log some sample strength training data for debugging
            if (strengthActivities.length > 0) {
              const sampleStrength = strengthActivities[0];
              console.log(`🔍 Sample strength training activity:`, {
                id: sampleStrength.id,
                name: sampleStrength.name,
                type: sampleStrength.type,
                totalReps: sampleStrength.totalReps,
                totalSets: sampleStrength.totalSets,
                hasExerciseSets: !!(sampleStrength.exerciseSets && sampleStrength.exerciseSets.length > 0),
                hasWorkoutTiming: !!(sampleStrength.workoutTiming),
                exerciseSetCount: sampleStrength.exerciseSets ? sampleStrength.exerciseSets.length : 0
              });
            }
            
            dropArea.innerHTML = `
              <div style="text-align: center;">
                <div style="font-size: 32px; margin-bottom: 10px;">✅</div>
                <div>Ready to upload!</div>
                <div style="font-size: 12px; margin-top: 5px;">${activitiesWithGPS.length} with GPS, ${activitiesWithoutGPS.length} without GPS</div>
              </div>
            `;
            
            setTimeout(() => {
              document.body.removeChild(dropArea);
              resolve({ activitiesWithGPS, activitiesWithoutGPS, allActivities });
            }, 1500);
            
          } catch (error) {
            console.error('❌ Failed to parse JSON:', error);
            dropArea.innerHTML = `
              <div style="text-align: center; color: #dc3545;">
                <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
                <div>Error parsing JSON</div>
                <div style="font-size: 12px; margin-top: 5px;">Click to try again</div>
              </div>
            `;
            setTimeout(() => {
              dropArea.innerHTML = `
                <div style="text-align: center;">
                  <div style="font-size: 48px; margin-bottom: 10px;">📤</div>
                  <div style="font-weight: bold; margin-bottom: 10px;">Drop your GPS-enriched JSON file here</div>
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
  
  // Function to upload activities in batches to avoid worker timeout
  async function uploadAllActivities(activitiesData) {
    const { activitiesWithGPS, activitiesWithoutGPS, allActivities } = activitiesData;
    const uploadUrl = `${WORKER_BASE_URL}/update-all-activities`;
    const batchSize = 50; // Process 50 activities at a time
    
    console.log(`📤 Starting batch upload of ${allActivities.length} activities (${activitiesWithGPS.length} with GPS, ${activitiesWithoutGPS.length} without GPS)...`);
    console.log(`🎯 Target URL: ${uploadUrl}`);
    console.log(`📦 Batch size: ${batchSize} activities per request`);
    
    // Prepare the activities data
    const activitiesForUpload = allActivities.map(activity => ({
      activityId: activity.id,
      activityData: {
        name: activity.name,
        type: activity.type,
        startTime: activity.startTime,
        duration: activity.duration,
        movingTime: activity.movingTime,
        calories: activity.calories,
        averageHR: activity.averageHR,
        maxHR: activity.maxHR,
        distance: activity.distance,
        averageSpeed: activity.averageSpeed,
        maxSpeed: activity.maxSpeed,
        elevationGain: activity.elevationGain,
        elevationLoss: activity.elevationLoss,
        // Include strength training fields
        totalReps: activity.totalReps,
        totalSets: activity.totalSets,
        // Include cycling/running fields
        averagePower: activity.averagePower,
        maxPower: activity.maxPower,
        normalizedPower: activity.normalizedPower,
        trainingStressScore: activity.trainingStressScore,
        averageCadence: activity.averageCadence,
        maxCadence: activity.maxCadence,
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt
      },
      gpsData: activity.gpsData,
      weatherData: activity.weatherData,
      // Include strength training data
      exerciseSets: activity.exerciseSets,
      workoutTiming: activity.workoutTiming
    }));

    let totalImported = 0;
    let totalErrors = 0;
    let startIndex = 0;
    let batchNumber = 1;
    const totalBatches = Math.ceil(allActivities.length / batchSize);

    try {
      while (startIndex < allActivities.length) {
        console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (activities ${startIndex + 1}-${Math.min(startIndex + batchSize, allActivities.length)})...`);

        const uploadData = {
          activities: activitiesForUpload,
          batchSize: batchSize,
          startIndex: startIndex
        };

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(uploadData)
        });

        if (!response.ok) {
          throw new Error(`Batch ${batchNumber} failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || `Batch ${batchNumber} processing failed`);
        }

        totalImported += result.imported || 0;
        totalErrors += result.errors || 0;

        console.log(`✅ Batch ${batchNumber}/${totalBatches} completed: ${result.imported} imported, ${result.errors} errors (${result.progress}% total progress)`);

        if (result.errorDetails && result.errorDetails.length > 0) {
          console.warn('⚠️ Errors in this batch:', result.errorDetails);
        }

        if (result.isComplete) {
          console.log('🎉 All activities uploaded successfully!');
          break;
        }

        startIndex = result.nextStartIndex;
        batchNumber++;

        // Small delay between batches to be nice to the worker
        if (startIndex < allActivities.length) {
          console.log('⏳ Waiting 2 seconds before next batch...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      console.log(`🎉 Upload completed! Total: ${totalImported} imported, ${totalErrors} errors`);
      
      const successRate = Math.round((totalImported / (totalImported + totalErrors)) * 100) || 0;
      
      alert(`✅ Upload Complete!\n\n• ${totalImported} activities uploaded successfully\n• ${totalErrors} errors occurred\n• Success rate: ${successRate}%\n\nCheck console for detailed logs.`);

    } catch (error) {
      console.error('❌ Batch upload failed:', error);
      alert(`❌ Upload Failed\n\nError: ${error.message}\n\nProgress: ${totalImported} activities uploaded before failure.\nCheck console for details.`);
      throw error;
    }
  }
  
  // Main execution
  try {
    // Check if worker URL is configured
    if (WORKER_BASE_URL.includes('your-worker-name') || WORKER_BASE_URL.includes('your-account')) {
      console.error('❌ Please update the WORKER_BASE_URL in the script with your actual Cloudflare Worker URL');
      alert('❌ Configuration Required\n\nPlease update the WORKER_BASE_URL in the script with your actual Cloudflare Worker URL.');
      return;
    }
    
    console.log('📂 Please select your GPS-enriched JSON file...');
    console.log('💡 A drag-and-drop area will appear on your screen');
    
    const activitiesData = await createDragDropArea();
    
    if (activitiesData.allActivities.length === 0) {
      console.log('⚠️ No activities found in the file');
      alert('⚠️ No Activities\n\nNo activities were found in the selected file.');
      return;
    }
    
    // Confirm upload
    const totalBatches = Math.ceil(activitiesData.allActivities.length / 50);
    const confirm = window.confirm(`Ready to upload ${activitiesData.allActivities.length} activities to your Cloudflare Worker?\n\n• ${activitiesData.activitiesWithGPS.length} activities with GPS data\n• ${activitiesData.activitiesWithoutGPS.length} activities without GPS data\n• Will process in ${totalBatches} batches of 50 activities each\n• Estimated time: ${Math.ceil(totalBatches * 2)} minutes\n\nThis will update your database with all activity information.`);
    
    if (!confirm) {
      console.log('Upload cancelled by user');
      return;
    }
    
    await uploadAllActivities(activitiesData);
    
  } catch (error) {
    console.error('❌ Upload script failed:', error);
  }
})();

console.log(`
📤 Garmin Activities Upload Script Loaded!

Before running:
1. Update WORKER_BASE_URL with your actual Cloudflare Worker URL
2. Make sure your worker is deployed and accessible

This script will:
1. 📂 Ask you to select your activities JSON file
2. 🔍 Process all activities (with and without GPS data)
3. 📤 Upload all activities to your Cloudflare Worker database

The worker will store all activity data in your D1 database.
`);
