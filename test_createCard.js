/**
 * Test script: systematically try createCard with different params
 * Run: node test_createCard.js
 */
require('dotenv').config({ path: '/workspace/projects/.env' });
const sdk = require('./src/services/vmcardioSDK');
const rsa = require('./src/utils/rsaCrypto');

async function main() {
  // 1. First get products to see available codes
  console.log('=== 1. Fetching products from vmcardio ===');
  let products;
  try {
    products = await sdk.getProductCode();
    console.log(JSON.stringify(products, null, 2));
  } catch(e) {
    console.error('getProductCode failed:', e.message);
  }

  // 2. Try createCard with user_id parameter
  console.log('\n=== 2. Test createCard with user_id ===');
  const testCases = [
    { label: 'With user_id=20098106', params: { 
      app_id: process.env.VMCARDIO_APP_ID,
      product_code: 'G4411KU', 
      first_name: 'TestFirst', 
      last_name: 'TestLast',
      amount: 20,
      user_id: '20098106'
    }},
    { label: 'With holder_id=20098106', params: { 
      app_id: process.env.VMCARDIO_APP_ID,
      product_code: 'G4411KU', 
      first_name: 'TestFirst', 
      last_name: 'TestLast',
      amount: 20,
      holder_id: '20098106'
    }},
    { label: 'With card_holder=20098106', params: { 
      app_id: process.env.VMCARDIO_APP_ID,
      product_code: 'G4411KU', 
      first_name: 'TestFirst', 
      last_name: 'TestLast',
      amount: 20,
      card_holder: '20098106'
    }},
  ];

  for (const tc of testCases) {
    console.log(`\n--- ${tc.label} ---`);
    console.log('Params:', JSON.stringify(tc.params, null, 2));
    console.log('Encrypted:', rsa.encrypt(tc.params));
    try {
      const result = await sdk.createCard(tc.params);
      console.log('SUCCESS:', JSON.stringify(result, null, null, 2);
    } catch (e) {
      console.log('FAILED:', e.message);
    }
  }
}

main().catch(console.error);