/**
 * Test Activity Stats Endpoint
 * 
 * This script tests the /stats endpoint to see your comprehensive activity statistics.
 * Run this in the browser console to check your stats.
 */

(async function() {
  console.log('📊 Testing Activity Stats Endpoint...');
  
  const WORKER_BASE_URL = 'https://garmin-sync-worker.lev-s-cloudflare.workers.dev';
  
  try {
    console.log('🔍 Fetching activity statistics...');
    
    const response = await fetch(`${WORKER_BASE_URL}/stats`);
    
    if (!response.ok) {
      throw new Error(`Stats request failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Successfully retrieved activity statistics!');
      console.log('');
      
      const stats = result.stats;
      
      // Display main statistics
      console.log('📊 ACTIVITY OVERVIEW:');
      console.log(`  Total Activities: ${stats.totalCount.toLocaleString()}`);
      console.log(`  Total Time: ${stats.totalTime.formatted} (${stats.totalTime.seconds.toLocaleString()} seconds)`);
      console.log(`  Total Distance: ${stats.totalDistance.toLocaleString()} km`);
      console.log(`  Total Calories: ${stats.totalCalories.toLocaleString()}`);
      console.log(`  Total Elevation Gain: ${stats.totalElevationGain.toLocaleString()} m`);
      console.log('');
      
      // Strength training stats
      console.log('💪 STRENGTH TRAINING:');
      console.log(`  Total Reps: ${stats.totalReps.toLocaleString()}`);
      console.log(`  Total Sets: ${stats.totalSets.toLocaleString()}`);
      console.log(`  Total Exercise Sets (detailed): ${stats.totalExerciseSets.toLocaleString()}`);
      console.log(`  Total Working Time: ${stats.totalWorkingTime.formatted} (${stats.totalWorkingTime.seconds.toLocaleString()} seconds)`);
      console.log('');
      
      // Weather extremes
      console.log('🌡️ WEATHER EXTREMES:');
      console.log(`  Hottest Activity: ${stats.hottestActivityTemp !== null ? stats.hottestActivityTemp + '°C' : 'No data'}`);
      console.log(`  Coldest Activity: ${stats.coldestActivityTemp !== null ? stats.coldestActivityTemp + '°C' : 'No data'}`);
      console.log(`  Highest Wind Speed: ${stats.highestWindSpeed} m/s`);
      console.log(`  Highest Wind Gust: ${stats.highestWindGust} m/s`);
      console.log('');
      
      // Data coverage
      console.log('📍 DATA COVERAGE:');
      console.log(`  Activities with GPS: ${stats.activitiesWithGPS.toLocaleString()} (${Math.round(stats.activitiesWithGPS / stats.totalCount * 100)}%)`);
      console.log(`  Activities with Weather: ${stats.activitiesWithWeather.toLocaleString()} (${Math.round(stats.activitiesWithWeather / stats.totalCount * 100)}%)`);
      console.log('');
      
      // Activity type breakdown
      console.log('🏃 ACTIVITY BREAKDOWN:');
      console.log(`  Running: ${stats.runningCount.toLocaleString()}`);
      console.log(`  Cycling: ${stats.cyclingCount.toLocaleString()}`);
      console.log(`  Strength Training: ${stats.strengthTrainingCount.toLocaleString()}`);
      
      if (stats.activityTypeBreakdown && stats.activityTypeBreakdown.length > 0) {
        console.log('');
        console.log('📈 TOP ACTIVITY TYPES:');
        stats.activityTypeBreakdown.slice(0, 10).forEach(activity => {
          console.log(`  ${activity.type}: ${activity.count} (${activity.percentage}%)`);
        });
      }
      
      console.log('');
      console.log(`📅 Last Updated: ${new Date(stats.lastUpdated).toLocaleString()}`);
      console.log(`⚡ Cached: ${result.cached ? 'Yes' : 'No'}`);
      
    } else {
      console.error('❌ Failed to get stats:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  console.log('');
  console.log('🌐 You can also visit the endpoint directly in your browser:');
  console.log(`   ${WORKER_BASE_URL}/stats`);
})();
