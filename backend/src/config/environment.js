'use strict';

const path = require('node:path');

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stateBaseDir = process.env.STATE_BASE_DIR
  ? path.resolve(process.env.STATE_BASE_DIR)
  : path.join(process.cwd(), 'backend', 'var');

const stateFilePath = process.env.STATE_FILE
  ? path.resolve(process.env.STATE_FILE)
  : path.join(stateBaseDir, 'state.json');

const config = {
  app: {
    port: toNumber(process.env.PORT, 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:8080').split(',').map((origin) => origin.trim()),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
  },
  state: {
    snapshotPath: stateFilePath,
    snapshotIntervalMs: toNumber(process.env.STATE_SNAPSHOT_INTERVAL_MS, 30_000),
    baseDir: stateBaseDir,
  },
};

module.exports = config;
