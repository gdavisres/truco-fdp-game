'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { Server } = require('socket.io');

const config = require('./config/environment');
const logger = require('./config/logger');
const roomsRouter = require('./api/rooms');
const { stateManager } = require('./modules/stateManager');
const { roomManager } = require('./modules/roomManager');
const { registerRoomHandlers } = require('./socket/roomHandlers');
const { configureSecurityHeaders, configureCORS } = require('./modules/security');

const createApp = () => {
  const app = express();

  const httpLogger = morgan(
    (tokens, req, res) =>
      JSON.stringify({
        method: tokens.method(req, res),
        url: tokens.url(req, res),
        statusCode: Number(tokens.status(req, res)),
        responseTime: Number(tokens['response-time'](req, res)),
        contentLength: tokens.res(req, res, 'content-length'),
        userAgent: req.headers['user-agent'],
      }),
    {
      stream: {
        write: (message) => {
          try {
            logger.info('http.request', JSON.parse(message));
          } catch (error) {
            logger.warn('http.logger_parse_failed', {
              error: error.message,
              raw: message.trim(),
            });
          }
        },
      },
    },
  );

  app.use(helmet());
  configureSecurityHeaders(app); // Additional security headers
  app.use(compression()); // Enable gzip compression
  // Configure CORS with explicit origin check so we can log and debug mismatches.
  const allowedOrigins = Array.isArray(config.cors.origin) ? config.cors.origin : [config.cors.origin];
  app.use(cors({
    origin: (origin, callback) => {
      // No origin means server-to-server or curl; allow it
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Log blocked origin for debugging and do not allow
      logger.warn('cors.origin_blocked', { origin, allowedOrigins });
      return callback(null, false);
    },
    credentials: true,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(httpLogger);

  // Prevent CDN/edge from caching API responses which can cause 304 responses
  // to be returned without CORS headers by intermediate caches. Set no-store
  // for API endpoints so browsers always receive fresh responses with CORS.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (req, res) => {
    const { getSecurityStats } = require('./modules/security');
    const memoryUsage = process.memoryUsage();
    const rooms = roomManager.listRooms();
    
    // Count active players across all rooms
    let activePlayers = 0;
    if (Array.isArray(rooms)) {
      rooms.forEach(room => {
        if (room.players && Array.isArray(room.players)) {
          activePlayers += room.players.length;
        }
      });
    }
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        rss: memoryUsage.rss,
        external: memoryUsage.external,
      },
      activeRooms: Array.isArray(rooms) ? rooms.length : 0,
      activePlayers,
      security: getSecurityStats(),
    });
  });

  app.use('/api/rooms', roomsRouter);

  app.use((req, res, next) => {
    const error = new Error('Not Found');
    error.statusCode = 404;
    next(error);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logger.error('http.error', {
      statusCode: error.statusCode || 500,
      message: error.message,
      stack: config.app.nodeEnv === 'development' ? error.stack : undefined,
      path: req.path,
      method: req.method,
    });

    res.status(error.statusCode || 500).json({
      error: error.name || 'ServerError',
      message: error.message || 'Unexpected server error',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
};

const app = createApp();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: config.cors.origin,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  connectTimeout: 10_000,
});

registerRoomHandlers(io, { roomManager, logger });

const start = async () => {
  await stateManager.init();

  return new Promise((resolve) => {
    httpServer.listen(config.app.port, () => {
      logger.info('server.listening', { port: config.app.port, environment: config.app.nodeEnv });
      resolve(httpServer);
    });
  });
};

const stop = async () => {
  await new Promise((resolve, reject) => {
    io.close(() => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  await stateManager.stop();
};

if (require.main === module) {
  start().catch((error) => {
    logger.error('server.start_failed', { message: error.message });
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  io,
  start,
  stop,
  httpServer,
};
