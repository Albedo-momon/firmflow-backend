#!/usr/bin/env node

/**
 * Generate a test JWT token for security testing
 */

const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'fallback-secret';
const payload = {
  userId: 'test-user-123',
  email: 'test@example.com',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
};

const token = jwt.sign(payload, secret);
console.log('Generated test JWT token:');
console.log(token);
console.log('\nSet this as TEST_JWT environment variable:');
console.log(`export TEST_JWT="${token}"`);