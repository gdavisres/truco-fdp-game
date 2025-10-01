'use strict';

const LEVELS = ['debug', 'info', 'warn', 'error'];

const formatPayload = (level, message, metadata = {}) => ({
  level,
  message,
  timestamp: new Date().toISOString(),
  ...metadata,
});

const log = (level, message, metadata) => {
  if (!LEVELS.includes(level)) {
    throw new Error(`Unsupported log level: ${level}`);
  }

  const payload = formatPayload(level, message, metadata);

  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(payload));
    return;
  }

  if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify(payload));
    return;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
};

const logger = {
  debug: (message, metadata) => log('debug', message, metadata),
  info: (message, metadata) => log('info', message, metadata),
  warn: (message, metadata) => log('warn', message, metadata),
  error: (message, metadata) => log('error', message, metadata),
  child: (metadata = {}) => ({
    debug: (message, childMeta) => logger.debug(message, { ...metadata, ...childMeta }),
    info: (message, childMeta) => logger.info(message, { ...metadata, ...childMeta }),
    warn: (message, childMeta) => logger.warn(message, { ...metadata, ...childMeta }),
    error: (message, childMeta) => logger.error(message, { ...metadata, ...childMeta }),
  }),
};

module.exports = logger;
