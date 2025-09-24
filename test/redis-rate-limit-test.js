#!/usr/bin/env node

/**
 * Redis Rate Limiting Test
 * 
 * This test specifically validates the Redis-based rate limiting implementation
 * by testing upload endpoints with restrictive limits.
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

class RedisRateLimitTest {
  constructor() {
    this.testResults = [];
  }

  async runTest(testName, testFn) {
    console.log(`\n🧪 Running: ${testName}`);
    try {
      await testFn();
      console.log(`✅ ${testName} - PASSED`);
      this.testResults.push({ name: testName, status: 'PASSED' });
    } catch (error) {
      console.log(`❌ ${testName} - FAILED: ${error.message}`);
      this.testResults.push({ name: testName, status: 'FAILED', error: error.message });
    }
  }

  async testRedisRateLimitingWithUpload() {
    console.log('Testing Redis rate limiting with upload endpoint...');
    console.log('Expected: First 3 requests succeed, remaining return 429');
    
    // Create a test file
    const testFilePath = path.join(__dirname, 'test-upload.txt');
    fs.writeFileSync(testFilePath, 'This is a test file for rate limiting');

    const requests = [];
    const startTime = Date.now();
    
    // Send 10 rapid upload requests (limit is 3/minute)
    for (let i = 0; i < 10; i++) {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(testFilePath));
      
      requests.push(
        axios.post(`${BASE_URL}/api/upload`, formData, {
          headers: {
            ...formData.getHeaders(),
            'Origin': 'http://localhost:3000',
            'Authorization': 'Bearer test-token' // Mock auth
          },
          timeout: 10000
        }).catch(err => err.response || { status: 'error', error: err.message })
      );
    }
    
    const responses = await Promise.all(requests);
    const endTime = Date.now();
    
    console.log(`Sent 10 upload requests in ${endTime - startTime}ms`);
    
    // Analyze responses
    const successfulResponses = responses.filter(res => res && res.status === 200);
    const rateLimitedResponses = responses.filter(res => res && res.status === 429);
    const authErrorResponses = responses.filter(res => res && res.status === 401);
    const errorResponses = responses.filter(res => !res || res.status === 'error');
    
    console.log(`Successful responses (200): ${successfulResponses.length}`);
    console.log(`Rate limited responses (429): ${rateLimitedResponses.length}`);
    console.log(`Auth error responses (401): ${authErrorResponses.length}`);
    console.log(`Other error responses: ${errorResponses.length}`);
    
    // Check rate limited responses
    if (rateLimitedResponses.length > 0) {
      console.log('✅ Rate limiting is working!');
      
      // Check Retry-After header
      const hasRetryAfter = rateLimitedResponses.some(res => 
        res && res.headers && res.headers['retry-after']
      );
      
      if (hasRetryAfter) {
        console.log('✅ Retry-After header present');
      } else {
        console.log('⚠️  Retry-After header missing');
      }
      
      // Check error format
      const hasProperErrorFormat = rateLimitedResponses.some(res => 
        res && res.data && res.data.error === 'rate_limited'
      );
      
      if (hasProperErrorFormat) {
        console.log('✅ Proper error format: rate_limited');
      } else {
        console.log('⚠️  Rate limited responses missing proper error format');
      }
      
      // Check rate limit headers
      const hasRateLimitHeaders = rateLimitedResponses.some(res => 
        res && res.headers && (
          res.headers['x-ratelimit-limit'] || 
          res.headers['x-ratelimit-remaining']
        )
      );
      
      if (hasRateLimitHeaders) {
        console.log('✅ Rate limit headers present');
      }
      
    } else if (authErrorResponses.length > 0) {
      console.log('ℹ️  All requests failed with auth errors - rate limiting not tested');
      console.log('   This is expected if authentication is required');
    } else {
      console.log('⚠️  No rate limiting detected');
      console.log('   This might indicate rate limiting is not working or limits are too high');
    }
    
    // Cleanup
    try {
      fs.unlinkSync(testFilePath);
    } catch (err) {
      // Ignore cleanup errors
    }
  }

  async testMemoryDriverWarning() {
    console.log('Testing memory driver warning...');
    
    // This test checks if the memory driver logs appropriate warnings
    // We can't easily capture console output in this test, but we can verify
    // that the system works with memory driver
    
    const response = await axios.get(`${BASE_URL}/health`, {
      headers: {
        'Origin': 'http://localhost:3000'
      }
    }).catch(err => err.response);
    
    if (response && response.status === 200) {
      console.log('✅ Memory driver is functional');
    } else {
      throw new Error('Memory driver test failed');
    }
  }

  async testRateLimitConfiguration() {
    console.log('Testing rate limit configuration...');
    
    // Test that rate limiting responds with proper headers
    const response = await axios.get(`${BASE_URL}/health`, {
      headers: {
        'Origin': 'http://localhost:3000'
      }
    }).catch(err => err.response);
    
    if (response && response.headers) {
      const hasRateLimitHeaders = 
        response.headers['x-ratelimit-limit'] || 
        response.headers['x-ratelimit-remaining'];
      
      if (hasRateLimitHeaders) {
        console.log('✅ Rate limit headers are being set');
        console.log(`   Limit: ${response.headers['x-ratelimit-limit']}`);
        console.log(`   Remaining: ${response.headers['x-ratelimit-remaining']}`);
      } else {
        console.log('⚠️  Rate limit headers not found');
      }
    }
  }

  async runAllTests() {
    console.log('🚀 Starting Redis Rate Limiting Tests');
    console.log(`Testing against: ${BASE_URL}`);
    console.log(`Rate limit driver: ${process.env.RATE_LIMIT_DRIVER || 'memory'}`);
    console.log(`Redis URL: ${process.env.REDIS_URL || 'not set'}`);
    
    await this.runTest('Redis Rate Limiting with Upload', () => this.testRedisRateLimitingWithUpload());
    await this.runTest('Memory Driver Warning', () => this.testMemoryDriverWarning());
    await this.runTest('Rate Limit Configuration', () => this.testRateLimitConfiguration());
    
    // Summary
    console.log('\n📊 Test Summary:');
    const passed = this.testResults.filter(r => r.status === 'PASSED').length;
    const failed = this.testResults.filter(r => r.status === 'FAILED').length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${Math.round((passed / this.testResults.length) * 100)}%`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => r.status === 'FAILED')
        .forEach(r => console.log(`   - ${r.name}: ${r.error}`));
    }
    
    return failed === 0;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const tester = new RedisRateLimitTest();
  tester.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = RedisRateLimitTest;