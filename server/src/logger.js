import pino from 'pino';
import config from './config.js';

const logger = pino({
  level: config.logLevel,
  base: undefined,
  redact: ['req.headers.cookie', 'req.headers["x-test-key"]', 'req.headers.authorization'],
});

export default logger;
