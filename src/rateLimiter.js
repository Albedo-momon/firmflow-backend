const redisClient = require('./redisClient');

class RateLimiter {
  constructor() {
    this.driver = process.env.RATE_LIMIT_DRIVER || 'memory';
    this.memoryStore = new Map();
    this.initialized = false;
    
    if (this.driver === 'memory') {
      console.warn('⚠️  Memory rate limiter not production ready - use Redis for production');
    }
  }

  async initialize() {
    if (this.initialized) return;

    if (this.driver === 'redis') {
      try {
        await redisClient.connect();
        console.log('✅ Rate limiter using Redis driver');
      } catch (error) {
        console.warn('⚠️  Redis connection failed, falling back to memory driver:', error.message);
        this.driver = 'memory';
      }
    }

    this.initialized = true;
  }

  /**
   * Check rate limit for a user
   * @param {string} userId - User identifier
   * @param {string} key - Rate limit key (e.g., 'per_minute', 'per_hour')
   * @param {number} limit - Maximum requests allowed
   * @param {number} windowSeconds - Time window in seconds
   * @returns {Promise<{allowed: boolean, remaining: number, resetTime: number, retryAfter?: number}>}
   */
  async checkLimit(userId, key, limit, windowSeconds) {
    await this.initialize();

    if (this.driver === 'redis') {
      return this._checkLimitRedis(userId, key, limit, windowSeconds);
    } else {
      return this._checkLimitMemory(userId, key, limit, windowSeconds);
    }
  }

  async _checkLimitRedis(userId, key, limit, windowSeconds) {
    try {
      const redis = redisClient.getClient();
      if (!redis || !redisClient.isReady()) {
        console.warn('⚠️  Redis not available, falling back to memory');
        return this._checkLimitMemory(userId, key, limit, windowSeconds);
      }

      const redisKey = `rl:${userId}:${key}`;
      
      // Use Redis pipeline for atomic operations
      const pipeline = redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.ttl(redisKey);
      
      const results = await pipeline.exec();
      
      if (!results || results.length !== 2) {
        throw new Error('Redis pipeline failed');
      }

      const [incrResult, ttlResult] = results;
      
      if (incrResult[0] || ttlResult[0]) {
        throw new Error('Redis command failed');
      }

      const currentCount = incrResult[1];
      const ttl = ttlResult[1];

      // If this is the first request or TTL is not set, set expiration
      if (currentCount === 1 || ttl === -1) {
        await redis.expire(redisKey, windowSeconds);
      }

      const allowed = currentCount <= limit;
      const remaining = Math.max(0, limit - currentCount);
      const resetTime = Date.now() + (ttl > 0 ? ttl * 1000 : windowSeconds * 1000);

      const result = {
        allowed,
        remaining,
        resetTime,
        current: currentCount,
        limit
      };

      if (!allowed) {
        result.retryAfter = ttl > 0 ? ttl : windowSeconds;
      }

      return result;

    } catch (error) {
      console.error('❌ Redis rate limit check failed:', error.message);
      console.warn('⚠️  Falling back to memory rate limiter');
      return this._checkLimitMemory(userId, key, limit, windowSeconds);
    }
  }

  _checkLimitMemory(userId, key, limit, windowSeconds) {
    const memoryKey = `${userId}:${key}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    if (!this.memoryStore.has(memoryKey)) {
      this.memoryStore.set(memoryKey, {
        count: 1,
        resetTime: now + windowMs
      });

      return {
        allowed: true,
        remaining: limit - 1,
        resetTime: now + windowMs,
        current: 1,
        limit
      };
    }

    const entry = this.memoryStore.get(memoryKey);

    // Reset if window has expired
    if (now >= entry.resetTime) {
      entry.count = 1;
      entry.resetTime = now + windowMs;

      return {
        allowed: true,
        remaining: limit - 1,
        resetTime: entry.resetTime,
        current: 1,
        limit
      };
    }

    // Increment counter
    entry.count++;

    const allowed = entry.count <= limit;
    const remaining = Math.max(0, limit - entry.count);

    const result = {
      allowed,
      remaining,
      resetTime: entry.resetTime,
      current: entry.count,
      limit
    };

    if (!allowed) {
      result.retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    }

    return result;
  }

  /**
   * Clean up expired entries from memory store
   */
  cleanupMemoryStore() {
    if (this.driver !== 'memory') return;

    const now = Date.now();
    for (const [key, entry] of this.memoryStore.entries()) {
      if (now >= entry.resetTime) {
        this.memoryStore.delete(key);
      }
    }
  }

  /**
   * Get current driver being used
   */
  getDriver() {
    return this.driver;
  }

  /**
   * Reset rate limit for a user (useful for testing)
   */
  async reset(userId, key) {
    if (this.driver === 'redis') {
      try {
        const redis = redisClient.getClient();
        if (redis && redisClient.isReady()) {
          const redisKey = `rl:${userId}:${key}`;
          await redis.del(redisKey);
        }
      } catch (error) {
        console.error('❌ Failed to reset Redis rate limit:', error.message);
      }
    } else {
      const memoryKey = `${userId}:${key}`;
      this.memoryStore.delete(memoryKey);
    }
  }
}

// Export singleton instance
const rateLimiter = new RateLimiter();

// Cleanup memory store every 5 minutes
if (rateLimiter.getDriver() === 'memory') {
  setInterval(() => {
    rateLimiter.cleanupMemoryStore();
  }, 5 * 60 * 1000);
}

module.exports = rateLimiter;