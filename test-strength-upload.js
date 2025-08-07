/**
 * Test Script for Strength Training Data Upload
 * 
 * This script helps verify that strength training data is being properly uploaded
 * and stored in your database. Run this in the browser console after uploading.
 */

(async function() {
  console.log('🧪 Testing Strength Training Data Upload...');
  
  const WORKER_BASE_URL = 'https://garmin-sync-worker.lev-s-cloudflare.workers.dev';
  
  // Test sample strength training activity
  const sampleStrengthActivity = {
    activityId: 'test-strength-123',
    activityData: {
      name: 'Test Strength Training',
      type: 'strength_training',
      startTime: new Date().toISOString(),
      duration: 3600, // 1 hour
      movingTime: 2400, // 40 minutes
      calories: 300,
      totalReps: 120,
      totalSets: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    exerciseSets: [
      {
        exerciseName: 'Bench Press',
        category: 'chest',
        sets: [
          { reps: 10, weight: 80, duration: 60 },
          { reps: 8, weight: 85, duration: 70 },
          { reps: 6, weight: 90, duration: 80 }
        ],
        totalReps: 24,
        totalSets: 3,
        totalVolume: 2010, // (10*80 + 8*85 + 6*90)
        totalWorkingTime: 210
      },
      {
        exerciseName: 'Squats',
        category: 'legs',
        sets: [
          { reps: 12, weight: 100, duration: 90 },
          { reps: 10, weight: 110, duration: 100 },
          { reps: 8, weight: 120, duration: 110 }
        ],
        totalReps: 30,
        totalSets: 3,
        totalVolume: 3460, // (12*100 + 10*110 + 8*120)
        totalWorkingTime: 300
      }
    ],
    workoutTiming: {
      totalWorkingTime: 510, // 8.5 minutes
      totalRestTime: 1890, // 31.5 minutes
      workToRestRatio: 0.27,
      workPercentage: 21
    }
  };
  
  try {
    console.log('📤 Sending test strength training activity...');
    console.log('📊 Activity data:', sampleStrengthActivity);
    
    const response = await fetch(`${WORKER_BASE_URL}/update-all-activities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        activities: [sampleStrengthActivity],
        batchSize: 1,
        startIndex: 0
      })
    });
    
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    console.log('✅ Upload response:', result);
    
    if (result.success) {
      console.log('🎉 Test upload successful!');
      console.log(`📈 Results: ${result.imported} imported, ${result.errors} errors`);
      
      if (result.errors > 0 && result.errorDetails) {
        console.warn('⚠️ Error details:', result.errorDetails);
      }
    } else {
      console.error('❌ Test upload failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  console.log('🧪 Test completed. Check your database to verify the data was stored correctly.');
  console.log('💡 Expected data in activities table:');
  console.log('  - total_reps: 120');
  console.log('  - total_sets: 12');
  console.log('  - total_working_time: 510');
  console.log('  - total_rest_time: 1890');
  console.log('  - work_to_rest_ratio: 0.27');
  console.log('  - work_percentage: 21');
  console.log('💡 Expected data in exercise_sets table: 6 rows (3 for Bench Press, 3 for Squats)');
})();
