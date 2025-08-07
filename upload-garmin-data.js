/**
 * Garmin Data Uploader
 * Upload your exported JSON file to the Cloudflare Worker
 */

// Configuration - replace with your worker URL
const WORKER_URL = 'https://garmin-sync-worker.lev-s-cloudflare.workers.dev';

// Upload function
async function uploadGarminData(jsonData) {
  console.log('📤 Uploading Garmin data to worker...');
  
  try {
    const response = await fetch(`${WORKER_URL}/import-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonData)
    });
    
    if (response.ok) {
      const result = await response.text();
      console.log('✅ Upload successful!');
      console.log(result);
    } else {
      console.error('❌ Upload failed:', response.status, response.statusText);
      const error = await response.text();
      console.error(error);
    }
  } catch (error) {
    console.error('❌ Upload error:', error);
  }
}

// Instructions
console.log('🚀 Garmin Data Uploader');
console.log('');
console.log('📋 Instructions:');
console.log('1. Update WORKER_URL above with your actual worker URL');
console.log('2. Load your JSON file into a variable called "garminData"');
console.log('3. Run: uploadGarminData(garminData)');
console.log('');
console.log('💡 Example:');
console.log('   const garminData = { /* your JSON data */ };');
console.log('   uploadGarminData(garminData);');
console.log('');

// Alternative: File upload method
window.uploadFromFile = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const jsonData = JSON.parse(e.target.result);
        console.log(`📄 Loaded file: ${jsonData.totalActivities} activities`);
        uploadGarminData(jsonData);
      } catch (error) {
        console.error('❌ Failed to parse JSON file:', error);
      }
    };
    reader.readAsText(file);
  };
  
  input.click();
};

console.log('📁 Or run: uploadFromFile() to select and upload a JSON file');
