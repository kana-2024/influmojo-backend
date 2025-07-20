require('dotenv').config({ path: './.env' });

const twilio = require('twilio');

console.log('=== Twilio Configuration Test ===');

// Check if credentials are loaded
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? '✅ Set' : '❌ Missing');
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? '✅ Set' : '❌ Missing');
console.log('TWILIO_VERIFY_SERVICE_SID:', process.env.TWILIO_VERIFY_SERVICE_SID ? '✅ Set' : '❌ Missing');

if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_VERIFY_SERVICE_SID) {
  console.log('❌ Missing Twilio credentials. Please check your .env file.');
  process.exit(1);
}

// Test Twilio client creation
try {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio client created successfully');
  
  // Test account info
  client.api.accounts(process.env.TWILIO_ACCOUNT_SID)
    .fetch()
    .then(account => {
      console.log('✅ Account Status:', account.status);
      console.log('✅ Account Type:', account.type);
      console.log('✅ Account Name:', account.friendlyName);
      
      if (account.status === 'suspended') {
        console.log('❌ Account is suspended!');
      } else if (account.type === 'Trial') {
        console.log('⚠️  Trial account - can only send to verified numbers');
      }
    })
    .catch(error => {
      console.log('❌ Account check failed:', error.message);
    });
    
} catch (error) {
  console.log('❌ Failed to create Twilio client:', error.message);
}

console.log('\n=== Test Complete ===');
console.log('If you see errors above, that explains why SMS is not working.');
console.log('For development, check the backend console for OTP codes.'); 