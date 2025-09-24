const Redis = require('ioredis');

class UserQuotaService {
  constructor() {
    this.enabled = process.env.USER_QUOTA_ENABLED === 'true';
    this.dailyLimit = parseInt(process.env.USER_DAILY_UPLOAD_LIMIT) || 100; // MB
    this.monthlyLimit = parseInt(process.env.USER_MONTHLY_UPLOAD_LIMIT) || 1000; // MB
    
    if (this.enabled) {
      try {
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        console.log('📊 User quota tracking enabled');
      } catch (error) {
        console.warn('Redis not available for quota tracking, using in-memory fallback');
        this.quotaCache = new Map();
        this.redis = null;
      }
    } else {
      console.log('📊 User quota tracking disabled');
    }
  }

  /**
   * Check if user can upload file of given size
   * @param {string} userId - User ID
   * @param {number} fileSizeBytes - File size in bytes
   * @returns {Promise<{allowed: boolean, reason?: string, usage?: Object}>}
   */
  async checkQuota(userId, fileSizeBytes) {
    if (!this.enabled) {
      return { allowed: true };
    }

    const fileSizeMB = Math.ceil(fileSizeBytes / (1024 * 1024));
    
    try {
      const usage = await this.getUsage(userId);
      
      // Check daily limit
      if (usage.dailyUsage + fileSizeMB > this.dailyLimit) {
        return {
          allowed: false,
          reason: `Daily upload limit exceeded (${this.dailyLimit}MB)`,
          usage: {
            ...usage,
            dailyRemaining: Math.max(0, this.dailyLimit - usage.dailyUsage),
            monthlyRemaining: Math.max(0, this.monthlyLimit - usage.monthlyUsage)
          }
        };
      }
      
      // Check monthly limit
      if (usage.monthlyUsage + fileSizeMB > this.monthlyLimit) {
        return {
          allowed: false,
          reason: `Monthly upload limit exceeded (${this.monthlyLimit}MB)`,
          usage: {
            ...usage,
            dailyRemaining: Math.max(0, this.dailyLimit - usage.dailyUsage),
            monthlyRemaining: Math.max(0, this.monthlyLimit - usage.monthlyUsage)
          }
        };
      }
      
      return {
        allowed: true,
        usage: {
          ...usage,
          dailyRemaining: this.dailyLimit - usage.dailyUsage - fileSizeMB,
          monthlyRemaining: this.monthlyLimit - usage.monthlyUsage - fileSizeMB
        }
      };
      
    } catch (error) {
      console.error('Error checking quota:', error);
      // Allow upload if quota check fails
      return { allowed: true };
    }
  }

  /**
   * Record file upload usage
   * @param {string} userId - User ID
   * @param {number} fileSizeBytes - File size in bytes
   */
  async recordUsage(userId, fileSizeBytes) {
    if (!this.enabled) {
      return;
    }

    const fileSizeMB = Math.ceil(fileSizeBytes / (1024 * 1024));
    const now = new Date();
    const dailyKey = `quota:${userId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const monthlyKey = `quota:${userId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    try {
      if (this.redis) {
        // Use Redis for persistent storage
        const pipeline = this.redis.pipeline();
        
        pipeline.incrby(dailyKey, fileSizeMB);
        pipeline.expire(dailyKey, 86400 * 2); // Expire after 2 days
        
        pipeline.incrby(monthlyKey, fileSizeMB);
        pipeline.expire(monthlyKey, 86400 * 32); // Expire after 32 days
        
        await pipeline.exec();
      } else {
        // Use in-memory cache as fallback
        const currentDaily = this.quotaCache.get(dailyKey) || 0;
        const currentMonthly = this.quotaCache.get(monthlyKey) || 0;
        
        this.quotaCache.set(dailyKey, currentDaily + fileSizeMB);
        this.quotaCache.set(monthlyKey, currentMonthly + fileSizeMB);
        
        // Simple cleanup - remove old entries
        if (this.quotaCache.size > 10000) {
          const oldEntries = Array.from(this.quotaCache.keys()).slice(0, 1000);
          oldEntries.forEach(key => this.quotaCache.delete(key));
        }
      }
      
      console.log(`📊 Recorded ${fileSizeMB}MB usage for user ${userId}`);
      
    } catch (error) {
      console.error('Error recording usage:', error);
    }
  }

  /**
   * Get current usage for user
   * @param {string} userId - User ID
   * @returns {Promise<{dailyUsage: number, monthlyUsage: number}>}
   */
  async getUsage(userId) {
    const now = new Date();
    const dailyKey = `quota:${userId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const monthlyKey = `quota:${userId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    try {
      if (this.redis) {
        const [dailyUsage, monthlyUsage] = await Promise.all([
          this.redis.get(dailyKey),
          this.redis.get(monthlyKey)
        ]);
        
        return {
          dailyUsage: parseInt(dailyUsage) || 0,
          monthlyUsage: parseInt(monthlyUsage) || 0
        };
      } else {
        return {
          dailyUsage: this.quotaCache.get(dailyKey) || 0,
          monthlyUsage: this.quotaCache.get(monthlyKey) || 0
        };
      }
    } catch (error) {
      console.error('Error getting usage:', error);
      return { dailyUsage: 0, monthlyUsage: 0 };
    }
  }

  /**
   * Get quota limits and usage for user
   * @param {string} userId - User ID
   * @returns {Promise<Object>}
   */
  async getQuotaInfo(userId) {
    if (!this.enabled) {
      return {
        enabled: false,
        message: 'Quota tracking disabled'
      };
    }

    const usage = await this.getUsage(userId);
    
    return {
      enabled: true,
      limits: {
        dailyLimitMB: this.dailyLimit,
        monthlyLimitMB: this.monthlyLimit
      },
      usage: {
        dailyUsageMB: usage.dailyUsage,
        monthlyUsageMB: usage.monthlyUsage,
        dailyRemainingMB: Math.max(0, this.dailyLimit - usage.dailyUsage),
        monthlyRemainingMB: Math.max(0, this.monthlyLimit - usage.monthlyUsage)
      },
      percentages: {
        dailyUsedPercent: Math.round((usage.dailyUsage / this.dailyLimit) * 100),
        monthlyUsedPercent: Math.round((usage.monthlyUsage / this.monthlyLimit) * 100)
      }
    };
  }

  /**
   * Reset user quota (admin function)
   * @param {string} userId - User ID
   * @param {string} period - 'daily' or 'monthly'
   */
  async resetQuota(userId, period = 'both') {
    if (!this.enabled) {
      return;
    }

    const now = new Date();
    const dailyKey = `quota:${userId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const monthlyKey = `quota:${userId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    try {
      if (this.redis) {
        if (period === 'daily' || period === 'both') {
          await this.redis.del(dailyKey);
        }
        if (period === 'monthly' || period === 'both') {
          await this.redis.del(monthlyKey);
        }
      } else {
        if (period === 'daily' || period === 'both') {
          this.quotaCache.delete(dailyKey);
        }
        if (period === 'monthly' || period === 'both') {
          this.quotaCache.delete(monthlyKey);
        }
      }
      
      console.log(`📊 Reset ${period} quota for user ${userId}`);
      
    } catch (error) {
      console.error('Error resetting quota:', error);
      throw error;
    }
  }

  /**
   * Check service health
   */
  async checkHealth() {
    if (!this.enabled) {
      return { healthy: true, message: 'Quota tracking disabled' };
    }

    try {
      if (this.redis) {
        await this.redis.ping();
        return { healthy: true, storage: 'redis' };
      } else {
        return { 
          healthy: true, 
          storage: 'memory',
          warning: 'Using in-memory storage - quotas will reset on server restart'
        };
      }
    } catch (error) {
      return { 
        healthy: false, 
        error: error.message 
      };
    }
  }
}

module.exports = UserQuotaService;