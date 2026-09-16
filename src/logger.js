const pino = require('pino');

module.exports = pino({
  level: process.env.SOCKETI_LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss' },
  },
});
