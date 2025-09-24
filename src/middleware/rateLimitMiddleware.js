const rateLimiter = require('../rateLimiter');

/**
 * Create rate limiting middleware
 * @param {string} key - Rate limit key identifier
 * @param {number} limit - Maximum requests allowed
 * @param {number} windowSeconds - Time window in seconds
 * @param {function} getUserId - Function to extract user ID from request
 * @returns {function} Express middleware function
 */
function createRateLimitMiddleware(key, limit, windowSeconds, getUserId = (req) => req.ip) {
  return async (req, res, next) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        console.warn('⚠️  Rate limiting skipped - no user ID available');
        return next();
      }

      const result = await rateLimiter.checkLimit(userId, key, limit, windowSeconds);

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': limit,
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
      });

      if (!result.allowed) {
        // Log rate limit hit
        console.log(`RATE_LIMIT_HIT userId=${userId} limit=${limit} window=${windowSeconds} current=${result.current}`);

        // Set Retry-After header
        if (result.retryAfter) {
          res.set('Retry-After', result.retryAfter);
        }

        return res.status(429).json({
          error: 'rate_limited',
          message: 'Rate limit exceeded',
          retryAfter: result.retryAfter || windowSeconds,
          limit,
          remaining: result.remaining,
          resetTime: result.resetTime
        });
      }

      next();
    } catch (error) {
      console.error('❌ Rate limiting middleware error:', error);
      // In case of error, allow the request to proceed
      next();
    }
  };
}

/**
 * General rate limiter for all requests
 */
const generalRateLimiter = createRateLimitMiddleware(
  'general',
  parseInt(process.env.RATE_LIMIT_GENERAL_PER_MINUTE) || 60,
  60,
  (req) => req.ip
);

/**
 * Upload rate limiter for authenticated users
 */
const uploadRateLimiter = createRateLimitMiddleware(
  'upload_per_minute',
  parseInt(process.env.RATE_LIMIT_USER_PER_MINUTE) || 10,
  60,
  (req) => req.user?.id || req.ip
);

/**
 * Hourly upload rate limiter for authenticated users
 */
const uploadHourlyRateLimiter = createRateLimitMiddleware(
  'upload_per_hour',
  parseInt(process.env.RATE_LIMIT_USER_PER_HOUR) || 100,
  3600,
  (req) => req.user?.id || req.ip
);

/**
 * Combined upload rate limiter that checks both per-minute and per-hour limits
 */
const combinedUploadRateLimiter = async (req, res, next) => {
  // Check per-minute limit first
  uploadRateLimiter(req, res, (err) => {
    if (err || res.headersSent) {
      return;
    }
    
    // If per-minute check passed, check per-hour limit
    uploadHourlyRateLimiter(req, res, next);
  });
};

module.exports = {
  createRateLimitMiddleware,
  generalRateLimiter,
  uploadRateLimiter,
  uploadHourlyRateLimiter,
  combinedUploadRateLimiter
};