/**
 * Rate Limiting Module
 * 
 * Implements token bucket algorithm for rate limiting socket events.
 * Provides per-socket rate limiting with configurable limits per event type.
 * 
 * Features:
 * - Token bucket algorithm with configurable refill rate
 * - Per-event-type rate limits
 * - Exponential backoff for repeated violations
 * - Automatic cleanup of expired rate limiters
 * - Comprehensive logging of violations
 */

const { randomUUID } = require('crypto');

// Rate limit configurations per event type
const RATE_LIMITS = {
  // Room events
  join_room: { tokens: 5, refillRate: 60000 }, // 5 joins per minute
  leave_room: { tokens: 3, refillRate: 60000 }, // 3 leaves per minute
  
  // Chat events
  chat_message: { tokens: 10, refillRate: 60000 }, // 10 messages per minute
  
  // Game actions (these are also enforced by game logic, but add rate limiting as defense)
  submit_bid: { tokens: 5, refillRate: 60000 }, // 5 bids per minute (backup validation)
  play_card: { tokens: 10, refillRate: 60000 }, // 10 card plays per minute (backup validation)
  
  // Settings and host actions
  update_host_settings: { tokens: 10, refillRate: 60000 }, // 10 settings updates per minute
  start_game: { tokens: 3, refillRate: 60000 }, // 3 game starts per minute
  
  // Default for any other event
  default: { tokens: 30, refillRate: 60000 }, // 30 actions per minute for unconfigured events
};

// Violation tracking for exponential backoff
const VIOLATION_THRESHOLDS = {
  warning: 3, // Log warning after 3 violations
  severe: 10, // Log severe after 10 violations
  critical: 30, // Consider blocking after 30 violations in a short period
};

/**
 * Token Bucket Rate Limiter
 * Implements the token bucket algorithm for smooth rate limiting
 */
class TokenBucket {
  constructor({ tokens, refillRate, socketId, eventType }) {
    this.maxTokens = tokens;
    this.tokens = tokens;
    this.refillRate = refillRate; // milliseconds
    this.tokensPerRefill = tokens / (refillRate / 1000); // tokens per second
    this.lastRefill = Date.now();
    this.socketId = socketId;
    this.eventType = eventType;
    this.violations = 0;
    this.createdAt = Date.now();
  }

  /**
   * Refill tokens based on time elapsed
   */
  refill() {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    
    if (timePassed > 0) {
      const tokensToAdd = (timePassed / 1000) * this.tokensPerRefill;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Attempt to consume tokens
   * @param {number} count - Number of tokens to consume (default 1)
   * @returns {boolean} - True if tokens were consumed, false if rate limited
   */
  consume(count = 1) {
    this.refill();
    
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    
    this.violations++;
    return false;
  }

  /**
   * Check if this bucket should trigger a warning
   */
  getViolationLevel() {
    if (this.violations >= VIOLATION_THRESHOLDS.critical) {
      return 'critical';
    }
    if (this.violations >= VIOLATION_THRESHOLDS.severe) {
      return 'severe';
    }
    if (this.violations >= VIOLATION_THRESHOLDS.warning) {
      return 'warning';
    }
    return 'normal';
  }

  /**
   * Get remaining tokens (for debugging/monitoring)
   */
  getRemainingTokens() {
    this.refill();
    return Math.floor(this.tokens);
  }
}

/**
 * Rate Limiter Manager
 * Manages rate limiters for all sockets and event types
 */
class RateLimiter {
  constructor() {
    this.limiters = new Map(); // socketId -> Map<eventType, TokenBucket>
    this.enabled = true;
    this.cleanupInterval = null;
    
    // Start periodic cleanup of expired limiters
    this.startCleanup();
  }

  /**
   * Get or create a rate limiter for a socket and event type
   */
  getLimiter(socketId, eventType) {
    if (!this.limiters.has(socketId)) {
      this.limiters.set(socketId, new Map());
    }
    
    const socketLimiters = this.limiters.get(socketId);
    
    if (!socketLimiters.has(eventType)) {
      const config = RATE_LIMITS[eventType] || RATE_LIMITS.default;
      const bucket = new TokenBucket({
        ...config,
        socketId,
        eventType,
      });
      socketLimiters.set(eventType, bucket);
    }
    
    return socketLimiters.get(eventType);
  }

  /**
   * Check if an action should be rate limited
   * @param {string} socketId - Socket ID
   * @param {string} eventType - Event type (e.g., 'chat_message')
   * @param {number} tokenCount - Number of tokens to consume (default 1)
   * @returns {Object} - { allowed: boolean, remaining: number, violationLevel: string }
   */
  checkLimit(socketId, eventType, tokenCount = 1) {
    if (!this.enabled) {
      return { allowed: true, remaining: Infinity, violationLevel: 'normal' };
    }
    
    const limiter = this.getLimiter(socketId, eventType);
    const allowed = limiter.consume(tokenCount);
    
    return {
      allowed,
      remaining: limiter.getRemainingTokens(),
      violationLevel: limiter.getViolationLevel(),
      violations: limiter.violations,
    };
  }

  /**
   * Remove rate limiters for a disconnected socket
   */
  removeSocket(socketId) {
    this.limiters.delete(socketId);
  }

  /**
   * Get statistics about rate limiting
   */
  getStats() {
    const stats = {
      totalSockets: this.limiters.size,
      totalLimiters: 0,
      violationCounts: {
        normal: 0,
        warning: 0,
        severe: 0,
        critical: 0,
      },
    };
    
    this.limiters.forEach((socketLimiters) => {
      socketLimiters.forEach((limiter) => {
        stats.totalLimiters++;
        const level = limiter.getViolationLevel();
        stats.violationCounts[level]++;
      });
    });
    
    return stats;
  }

  /**
   * Start periodic cleanup of old limiters
   */
  startCleanup() {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Clean up limiters that haven't been used in a while
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    
    let removed = 0;
    
    this.limiters.forEach((socketLimiters, socketId) => {
      const shouldRemove = Array.from(socketLimiters.values()).every(
        (limiter) => now - limiter.lastRefill > maxAge
      );
      
      if (shouldRemove) {
        this.limiters.delete(socketId);
        removed++;
      }
    });
    
    if (removed > 0) {
      console.log(`[RateLimiter] Cleaned up ${removed} inactive socket limiters`);
    }
  }

  /**
   * Enable or disable rate limiting (for testing)
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Stop cleanup interval
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Reset all rate limiters (for testing)
   */
  reset() {
    this.limiters.clear();
  }
}

// Singleton instance
const rateLimiter = new RateLimiter();

/**
 * Middleware function to check rate limits before socket event handlers
 * @param {string} eventType - Event type to rate limit
 * @param {Function} handler - Original event handler
 * @returns {Function} - Wrapped handler with rate limiting
 */
function withRateLimit(eventType, handler) {
  return async function rateLimitedHandler(socket, ...args) {
    const socketId = socket.id;
    const result = rateLimiter.checkLimit(socketId, eventType);
    
    if (!result.allowed) {
      // Rate limited - emit error to client
      const violationId = randomUUID();
      
      console.warn(`[RateLimiter] Rate limit exceeded`, {
        violationId,
        socketId,
        eventType,
        violations: result.violations,
        level: result.violationLevel,
        timestamp: new Date().toISOString(),
      });
      
      // Emit rate limit error
      socket.emit('rate_limit_exceeded', {
        error: 'rate_limited',
        message: 'You are sending requests too quickly. Please slow down.',
        eventType,
        violationId,
        retryAfter: 60, // seconds
      });
      
      // If there's an acknowledgment callback, call it with error
      const ack = args[args.length - 1];
      if (typeof ack === 'function') {
        ack({
          error: 'rate_limited',
          message: 'Rate limit exceeded',
          violationId,
        });
      }
      
      return;
    }
    
    // Log warning/severe violations even if request is allowed
    if (result.violationLevel !== 'normal') {
      console.warn(`[RateLimiter] Violation level: ${result.violationLevel}`, {
        socketId,
        eventType,
        violations: result.violations,
      });
    }
    
    // Rate limit passed - call original handler
    return handler(socket, ...args);
  };
}

/**
 * Clean up rate limiters when socket disconnects
 */
function handleDisconnect(socketId) {
  rateLimiter.removeSocket(socketId);
}

module.exports = {
  rateLimiter,
  withRateLimit,
  handleDisconnect,
  TokenBucket, // Export for testing
  RATE_LIMITS, // Export for testing/configuration
};
