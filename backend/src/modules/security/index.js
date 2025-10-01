/**
 * Security Module Index
 * 
 * Exports all security-related functionality:
 * - Rate limiting
 * - Input validation & sanitization
 * - Anti-cheat validation
 * - Security middleware
 */

const { rateLimiter, withRateLimit, handleDisconnect: handleRateLimitDisconnect } = require('./rateLimiter');
const inputValidator = require('./inputValidator');
const { antiCheatManager } = require('./antiCheat');

/**
 * Configure HTTP security headers using Helmet
 * @param {Express.Application} app - Express app instance
 */
function configureSecurityHeaders(app) {
  // For now, we'll use basic security headers
  // In production, add helmet: npm install helmet
  // const helmet = require('helmet');
  // app.use(helmet({
  //   contentSecurityPolicy: {
  //     directives: {
  //       defaultSrc: ["'self'"],
  //       scriptSrc: ["'self'", "'unsafe-inline'"],
  //       styleSrc: ["'self'", "'unsafe-inline'"],
  //       imgSrc: ["'self'", "data:", "https:"],
  //     },
  //   },
  // }));
  
  // Basic security headers
  app.use((req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection (legacy browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    next();
  });
}

/**
 * Configure CORS for production
 * @param {Express.Application} app - Express app instance
 * @param {Object} options - CORS options
 */
function configureCORS(app, options = {}) {
  const {
    allowedOrigins = ['http://localhost:3000', 'http://localhost:5173'], // Dev origins
    credentials = true,
  } = options;
  
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (credentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }
    
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    
    next();
  });
}

/**
 * Handle socket disconnection (cleanup security trackers)
 */
function handleSocketDisconnect(socketId, playerId) {
  handleRateLimitDisconnect(socketId);
  if (playerId) {
    antiCheatManager.removePlayer(playerId);
  }
}

/**
 * Get security statistics for monitoring
 */
function getSecurityStats() {
  return {
    rateLimit: rateLimiter.getStats(),
    antiCheat: antiCheatManager.getStats(),
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  // Rate limiting
  rateLimiter,
  withRateLimit,
  
  // Input validation
  inputValidator,
  
  // Anti-cheat
  antiCheatManager,
  
  // Middleware configuration
  configureSecurityHeaders,
  configureCORS,
  
  // Utility functions
  handleSocketDisconnect,
  getSecurityStats,
};
