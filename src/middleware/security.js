const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');

// Initialize Redis connection (with fallback to in-memory)
let redis = null;
let rateLimiters = {};

try {
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL);
    console.log('✅ Redis connected for rate limiting');
  } else {
    console.warn('⚠️  Redis not configured, using in-memory rate limiting (single instance only)');
  }
} catch (error) {
  console.warn('⚠️  Redis connection failed, falling back to in-memory rate limiting:', error.message);
  redis = null;
}

// Parse allowed origins from environment
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);

console.log('🔒 Allowed origins:', Array.from(allowedOrigins));

// Initialize rate limiters
const createRateLimiter = (keyPrefix, points, duration) => {
  if (redis) {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix,
      points,
      duration,
      blockDuration: 60, // Block for 1 minute after limit exceeded
    });
  } else {
    return new RateLimiterMemory({
      keyPrefix,
      points,
      duration,
      blockDuration: 60,
    });
  }
};

// Rate limiters
rateLimiters.userPerMinute = createRateLimiter(
  'rl_user_min',
  parseInt(process.env.RATE_LIMIT_USER_PER_MINUTE) || 5,
  60
);

rateLimiters.userPerHour = createRateLimiter(
  'rl_user_hour',
  parseInt(process.env.RATE_LIMIT_USER_PER_HOUR) || 100,
  3600
);

/**
 * Middleware to validate origin/referrer headers
 */
const validateOrigin = (req, res, next) => {
  const origin = req.get('Origin') || req.get('Referer');
  
  if (!origin) {
    console.warn('🚫 Origin validation failed: No Origin or Referer header', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    return res.status(403).json({ error: 'origin_not_allowed' });
  }

  // Normalize origin (remove trailing slash, extract domain from referer)
  let normalizedOrigin = origin;
  if (origin.includes('/') && !origin.startsWith('http')) {
    // Handle referer URLs - extract origin
    try {
      const url = new URL(origin);
      normalizedOrigin = `${url.protocol}//${url.host}`;
    } catch (e) {
      normalizedOrigin = origin;
    }
  }
  
  if (normalizedOrigin.endsWith('/')) {
    normalizedOrigin = normalizedOrigin.slice(0, -1);
  }

  if (!allowedOrigins.has(normalizedOrigin)) {
    console.warn('🚫 Origin validation failed: Disallowed origin', {
      origin: normalizedOrigin,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    return res.status(403).json({ error: 'origin_not_allowed' });
  }

  req.validatedOrigin = normalizedOrigin;
  next();
};

/**
 * Middleware to validate JWT authentication
 */
const validateAuth = (req, res, next) => {
  const authHeader = req.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'authentication_required' });
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    req.user = decoded;
    req.userId = decoded.userId || decoded.sub || decoded.id;
    
    if (!req.userId) {
      throw new Error('No user ID in token');
    }
    
    next();
  } catch (error) {
    console.warn('🚫 Auth validation failed:', error.message);
    return res.status(401).json({ error: 'invalid_token' });
  }
};

/**
 * Middleware to check rate limits
 */
const checkRateLimit = async (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'authentication_required' });
  }

  try {
    // Check per-minute limit
    await rateLimiters.userPerMinute.consume(req.userId);
    
    // Check per-hour limit
    await rateLimiters.userPerHour.consume(req.userId);
    
    next();
  } catch (rateLimiterRes) {
    const secs = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
    
    console.warn('🚫 Rate limit exceeded', {
      userId: req.userId,
      ip: req.ip,
      retryAfter: secs
    });
    
    res.set('Retry-After', String(secs));
    return res.status(429).json({
      error: 'rate_limited',
      retryAfter: secs
    });
  }
};

/**
 * Middleware to validate file upload parameters
 */
const validateFileUpload = (req, res, next) => {
  const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE_BYTES) || 10485760; // 10MB default
  const allowedMimes = (process.env.UPLOAD_ALLOWED_MIMES || 
    'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain')
    .split(',')
    .map(mime => mime.trim());

  // Store validation config on request for multer to use
  req.uploadConfig = {
    maxSize,
    allowedMimes
  };
  
  next();
};

/**
 * Log security events
 */
const logSecurityEvent = (event, details) => {
  console.log(`🔒 Security Event: ${event}`, {
    timestamp: new Date().toISOString(),
    ...details
  });
};

module.exports = {
  validateOrigin,
  validateAuth,
  checkRateLimit,
  validateFileUpload,
  logSecurityEvent,
  createRateLimiter,
  redis,
  allowedOrigins
};