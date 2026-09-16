const config = require('../config');

let instance = null;

function getAdapter() {
  if (instance) return instance;

  if (config.adapter === 'redis') {
    const RedisAdapter = require('./redisAdapter');
    instance = new RedisAdapter();
  } else {
    const LocalAdapter = require('./localAdapter');
    instance = new LocalAdapter();
  }
  return instance;
}

module.exports = { getAdapter };
