/**
 * Tests for Rate Limiter
 */

const { TokenBucket, rateLimiter, withRateLimit, RATE_LIMITS } = require('../../src/modules/security/rateLimiter');

describe('Rate Limiter', () => {
  beforeEach(() => {
    rateLimiter.reset();
    rateLimiter.setEnabled(true);
  });

  afterEach(() => {
    rateLimiter.stop();
  });

  describe('TokenBucket', () => {
    test('should create token bucket with correct initial state', () => {
      const bucket = new TokenBucket({
        tokens: 10,
        refillRate: 60000,
        socketId: 'test-socket',
        eventType: 'test_event',
      });

      expect(bucket.maxTokens).toBe(10);
      expect(bucket.tokens).toBe(10);
      expect(bucket.violations).toBe(0);
    });

    test('should consume tokens when available', () => {
      const bucket = new TokenBucket({
        tokens: 10,
        refillRate: 60000,
        socketId: 'test-socket',
        eventType: 'test_event',
      });

      expect(bucket.consume(1)).toBe(true);
      expect(bucket.getRemainingTokens()).toBe(9);
    });

    test('should reject when tokens exhausted', () => {
      const bucket = new TokenBucket({
        tokens: 2,
        refillRate: 60000,
        socketId: 'test-socket',
        eventType: 'test_event',
      });

      expect(bucket.consume(1)).toBe(true);
      expect(bucket.consume(1)).toBe(true);
      expect(bucket.consume(1)).toBe(false); // Should fail
      expect(bucket.violations).toBe(1);
    });

    test('should refill tokens over time', async () => {
      const bucket = new TokenBucket({
        tokens: 10,
        refillRate: 1000, // 1 second refill
        socketId: 'test-socket',
        eventType: 'test_event',
      });

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        bucket.consume(1);
      }
      expect(bucket.getRemainingTokens()).toBe(0);

      // Wait for refill
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Should have some tokens refilled
      const remaining = bucket.getRemainingTokens();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(10);
    });

    test('should track violation levels', () => {
      const bucket = new TokenBucket({
        tokens: 1,
        refillRate: 60000,
        socketId: 'test-socket',
        eventType: 'test_event',
      });

      bucket.consume(1); // Success
      
      // Trigger violations
      for (let i = 0; i < 2; i++) {
        bucket.consume(1); // Fails
      }
      expect(bucket.getViolationLevel()).toBe('normal'); // Below warning threshold

      for (let i = 0; i < 8; i++) {
        bucket.consume(1); // More failures
      }
      expect(bucket.getViolationLevel()).toBe('severe'); // Above warning, below critical
    });
  });

  describe('RateLimiter', () => {
    test('should create limiters per socket and event type', () => {
      const result1 = rateLimiter.checkLimit('socket-1', 'chat_message');
      const result2 = rateLimiter.checkLimit('socket-1', 'join_room');
      const result3 = rateLimiter.checkLimit('socket-2', 'chat_message');

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);

      const stats = rateLimiter.getStats();
      expect(stats.totalSockets).toBe(2);
    });

    test('should enforce rate limits per event type', () => {
      const config = RATE_LIMITS.chat_message;
      const socketId = 'test-socket';

      // Consume all tokens
      for (let i = 0; i < config.tokens; i++) {
        const result = rateLimiter.checkLimit(socketId, 'chat_message');
        expect(result.allowed).toBe(true);
      }

      // Next one should fail
      const result = rateLimiter.checkLimit(socketId, 'chat_message');
      expect(result.allowed).toBe(false);
      expect(result.violations).toBeGreaterThan(0);
    });

    test('should use default limits for unknown event types', () => {
      const socketId = 'test-socket';
      const unknownEvent = 'unknown_event_12345';

      const result = rateLimiter.checkLimit(socketId, unknownEvent);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    test('should remove socket limiters on disconnect', () => {
      const socketId = 'test-socket';
      
      rateLimiter.checkLimit(socketId, 'chat_message');
      expect(rateLimiter.getStats().totalSockets).toBe(1);

      rateLimiter.removeSocket(socketId);
      expect(rateLimiter.getStats().totalSockets).toBe(0);
    });

    test('should respect enabled flag', () => {
      const socketId = 'test-socket';
      
      rateLimiter.setEnabled(false);
      
      // Should allow unlimited requests when disabled
      for (let i = 0; i < 100; i++) {
        const result = rateLimiter.checkLimit(socketId, 'chat_message');
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('withRateLimit middleware', () => {
    test('should allow requests within rate limit', async () => {
      const mockSocket = { id: 'test-socket', emit: jest.fn() };
      const mockHandler = jest.fn();
      
      const wrappedHandler = withRateLimit('chat_message', mockHandler);
      
      await wrappedHandler(mockSocket, { message: 'test' });
      
      expect(mockHandler).toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalledWith('rate_limit_exceeded', expect.anything());
    });

    test('should block requests exceeding rate limit', async () => {
      const mockSocket = { id: 'test-socket', emit: jest.fn() };
      const mockHandler = jest.fn();
      const mockAck = jest.fn();
      
      const wrappedHandler = withRateLimit('chat_message', mockHandler);
      
      // Exhaust rate limit
      const config = RATE_LIMITS.chat_message;
      for (let i = 0; i < config.tokens; i++) {
        await wrappedHandler(mockSocket, {});
      }
      
      // Next request should be blocked
      await wrappedHandler(mockSocket, {}, mockAck);
      
      expect(mockSocket.emit).toHaveBeenCalledWith('rate_limit_exceeded', expect.objectContaining({
        error: 'rate_limited',
        eventType: 'chat_message',
      }));
      
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({
        error: 'rate_limited',
      }));
    });

    test('should call ack callback with error when rate limited', async () => {
      const mockSocket = { id: 'test-socket', emit: jest.fn() };
      const mockHandler = jest.fn();
      const mockAck = jest.fn();
      
      const wrappedHandler = withRateLimit('join_room', mockHandler);
      
      // Exhaust rate limit
      const config = RATE_LIMITS.join_room;
      for (let i = 0; i < config.tokens; i++) {
        await wrappedHandler(mockSocket, {});
      }
      
      // Next request with ack
      await wrappedHandler(mockSocket, {}, mockAck);
      
      expect(mockAck).toHaveBeenCalledWith({
        error: 'rate_limited',
        message: 'Rate limit exceeded',
        violationId: expect.any(String),
      });
    });
  });

  describe('Rate limit configurations', () => {
    test('should have appropriate limits for different event types', () => {
      expect(RATE_LIMITS.join_room.tokens).toBeLessThanOrEqual(5);
      expect(RATE_LIMITS.chat_message.tokens).toBeGreaterThanOrEqual(10);
      expect(RATE_LIMITS.leave_room.tokens).toBeLessThanOrEqual(5);
    });

    test('should have consistent refill rates', () => {
      const refillRates = Object.values(RATE_LIMITS).map(config => config.refillRate);
      const uniqueRates = new Set(refillRates);
      
      // Most should use 60000ms (1 minute) refill
      expect(uniqueRates.size).toBeLessThanOrEqual(3);
    });
  });
});
