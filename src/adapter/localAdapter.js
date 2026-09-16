const channelManager = require('../channelManager');
const webhooks = require('../webhooks');

// Single-process adapter: channelManager IS the global state, so no
// cross-instance relay is needed.
class LocalAdapter {
  async init() {}
  async close() {}

  async subscribe(app, channel, socketId, socket, memberData) {
    const isFirst = channelManager.members(app.id, channel).size === 0;
    channelManager.subscribe(app.id, channel, socketId, socket, memberData);
    if (isFirst) webhooks.dispatch(app, 'channel_occupied', { channel });

    const members = channelManager.members(app.id, channel);
    const ids = Array.from(members.keys());
    const hash = {};
    for (const [id, m] of members) hash[id] = m.memberData ? m.memberData.user_info : null;
    return { ids, hash, count: members.size };
  }

  async unsubscribe(app, channel, socketId) {
    const existing = channelManager.members(app.id, channel).get(socketId);
    channelManager.unsubscribe(app.id, channel, socketId);
    const remaining = channelManager.members(app.id, channel).size;
    if (remaining === 0) webhooks.dispatch(app, 'channel_vacated', { channel });
    return { memberData: existing ? existing.memberData : null, remaining };
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
  }

  async channelInfo(app, channel) {
    const members = channelManager.members(app.id, channel);
    return { occupied: members.size > 0, subscription_count: members.size };
  }

  async channelList(app, prefix) {
    const names = channelManager.channelNames(app.id);
    const result = {};
    for (const name of names) {
      if (prefix && !name.startsWith(prefix)) continue;
      result[name] = { subscription_count: channelManager.members(app.id, name).size };
    }
    return result;
  }

  async presenceUsers(app, channel) {
    const members = channelManager.members(app.id, channel);
    const users = [];
    for (const [, m] of members) if (m.memberData) users.push({ id: m.memberData.user_id });
    return users;
  }

  connectionCount(app) {
    return channelManager.localConnectionCount(app.id);
  }
}

module.exports = LocalAdapter;
