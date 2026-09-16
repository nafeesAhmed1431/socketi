const fs = require('fs');
const crypto = require('crypto');

function loadApps() {
  if (process.env.SOCKETI_APPS_JSON) {
    return JSON.parse(process.env.SOCKETI_APPS_JSON);
  }
  if (process.env.SOCKETI_APPS_FILE) {
    return JSON.parse(fs.readFileSync(process.env.SOCKETI_APPS_FILE, 'utf8'));
  }
  return [
    {
      id: process.env.SOCKETI_APP_ID || 'app1',
      key: process.env.SOCKETI_APP_KEY || 'app1key',
      secret: process.env.SOCKETI_APP_SECRET || 'app1secret',
    },
  ];
}

const defaults = {
  maxConnections: Infinity,
  enableClientMessages: true,
  maxPresenceMembers: 500,
  webhooks: [],
};

const apps = loadApps().map((a) => ({ ...defaults, ...a }));

const config = {
  nodeId: process.env.SOCKETI_NODE_ID || crypto.randomBytes(6).toString('hex'),
  port: parseInt(process.env.SOCKETI_PORT || '6001', 10),
  host: process.env.SOCKETI_HOST || '0.0.0.0',

  tls: {
    cert: process.env.SOCKETI_TLS_CERT || null,
    key: process.env.SOCKETI_TLS_KEY || null,
  },

  adapter: process.env.SOCKETI_ADAPTER || 'local', // 'local' | 'redis'
  redisUrl: process.env.SOCKETI_REDIS_URL || 'redis://127.0.0.1:6379',

  maxPayloadBytes: parseInt(process.env.SOCKETI_MAX_PAYLOAD_KB || '64', 10) * 1024,
  authTimestampToleranceSec: parseInt(process.env.SOCKETI_AUTH_TOLERANCE_SEC || '600', 10),

  rateLimit: {
    messagesPerWindow: parseInt(process.env.SOCKETI_RATE_LIMIT_MSGS || '50', 10),
    windowMs: parseInt(process.env.SOCKETI_RATE_LIMIT_WINDOW_MS || '10000', 10),
  },

  heartbeatIntervalMs: parseInt(process.env.SOCKETI_HEARTBEAT_MS || '30000', 10),

  apps,

  findByKey(key) {
    return apps.find((a) => a.key === key);
  },
  findById(id) {
    return apps.find((a) => a.id === id);
  },
};

module.exports = config;
