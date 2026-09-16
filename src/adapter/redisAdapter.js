const Redis = require('ioredis');
const config = require('../config');
const channelManager = require('../channelManager');
const webhooks = require('../webhooks');
const logger = require('../logger');

const RELAY_CHANNEL = 'socketi:relay';

// Cluster-ready adapter: membership/presence counts live in Redis so
// multiple socketi processes behind a load balancer see one consistent
// channel state. A pub/sub relay fans a broadcast() out to every other
// node so their locally-connected sockets receive it too.
class RedisAdapter {
  constructor() {
    this.pub = new Redis(config.redisUrl);
    this.sub = new Redis(config.redisUrl);
  }

  async init() {
    await this.sub.subscribe(RELAY_CHANNEL);
    this.sub.on('message', (_ch, raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.nodeId === config.nodeId) return; // already delivered locally by the publishing node
      channelManager.broadcastLocal(msg.appId, msg.channel, msg.payload);
    });
    this.pub.on('error', (err) => logger.error({ err: err.message }, 'redis pub error'));
    this.sub.on('error', (err) => logger.error({ err: err.message }, 'redis sub error'));
    logger.info({ url: config.redisUrl }, 'redis adapter connected');
  }

  async close() {
    await this.pub.quit().catch(() => {});
    await this.sub.quit().catch(() => {});
  }

  _subsKey(appId, channel) {
    return `socketi:subs:{${appId}}:${channel}`;
  }

  _presenceKey(appId, channel) {
    return `socketi:presence:{${appId}}:${channel}`;
  }

  async subscribe(app, channel, socketId, socket, memberData) {
    channelManager.subscribe(app.id, channel, socketId, socket, memberData);

    const subsKey = this._subsKey(app.id, channel);
    const added = await this.pub.sadd(subsKey, socketId);
    if (memberData) {
      await this.pub.hset(this._presenceKey(app.id, channel), socketId, JSON.stringify(memberData));
    }
    const count = await this.pub.scard(subsKey);
    if (added === 1 && count === 1) webhooks.dispatch(app, 'channel_occupied', { channel });

    const ids = await this.pub.smembers(subsKey);
    const presenceHash = await this.pub.hgetall(this._presenceKey(app.id, channel));
    const hash = {};
    for (const id of ids) {
      hash[id] = presenceHash[id] ? JSON.parse(presenceHash[id]).user_info : null;
    }
    return { ids, hash, count };
  }

  async unsubscribe(app, channel, socketId) {
    channelManager.unsubscribe(app.id, channel, socketId);

    const subsKey = this._subsKey(app.id, channel);
    const presenceKey = this._presenceKey(app.id, channel);
    const raw = await this.pub.hget(presenceKey, socketId);
    await this.pub.srem(subsKey, socketId);
    await this.pub.hdel(presenceKey, socketId);
    const remaining = await this.pub.scard(subsKey);
    if (remaining === 0) {
      webhooks.dispatch(app, 'channel_vacated', { channel });
      await this.pub.del(subsKey, presenceKey);
    }
    return { memberData: raw ? JSON.parse(raw) : null, remaining };
  }

  async unsubscribeAll(app, socketId) {
    const names = channelManager.channelNames(app.id);
    const removed = [];
    for (const channel of names) {
      if (channelManager.isSubscribed(app.id, channel, socketId)) {
        const result = await this.unsubscribe(app, channel, socketId);
        removed.push({ channel, ...result });
      }
    }
    return removed;
  }

  async broadcast(app, channel, payload, exceptSocketId) {
    channelManager.broadcastLocal(app.id, channel, payload, exceptSocketId);
    await this.pub.publish(RELAY_CHANNEL, JSON.stringify({
      appId: app.id, channel, payload, nodeId: config.nodeId,
    }));
  }

  async channelInfo(app, channel) {
    const count = await this.pub.scard(this._subsKey(app.id, channel));
    return { occupied: count > 0, subscription_count: count };
  }

  async channelList(app, prefix) {
    const keyPattern = this._subsKey(app.id, prefix ? `${prefix}*` : '*');
    const keys = await this.pub.keys(keyPattern);
    const result = {};
    for (const key of keys) {
      const channel = key.slice(this._subsKey(app.id, '').length);
      result[channel] = { subscription_count: await this.pub.scard(key) };
    }
    return result;
  }

  async presenceUsers(app, channel) {
    const hash = await this.pub.hgetall(this._presenceKey(app.id, channel));
    return Object.values(hash).map((raw) => ({ id: JSON.parse(raw).user_id }));
  }

  connectionCount(app) {
    return channelManager.localConnectionCount(app.id);
  }
}

module.exports = RedisAdapter;
