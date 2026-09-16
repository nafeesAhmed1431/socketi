// Tracks sockets connected to THIS process only. Cross-instance fan-out is
// handled by the adapter (local or redis) — see src/adapter.
class ChannelManager {
  constructor() {
    // appId -> channel -> Map(socketId -> { socket, memberData? })
    this.apps = new Map();
  }

  _channels(appId) {
    if (!this.apps.has(appId)) this.apps.set(appId, new Map());
    return this.apps.get(appId);
  }

  subscribe(appId, channel, socketId, socket, memberData) {
    const channels = this._channels(appId);
    if (!channels.has(channel)) channels.set(channel, new Map());
    channels.get(channel).set(socketId, { socket, memberData });
  }

  unsubscribe(appId, channel, socketId) {
    const channels = this._channels(appId);
    const members = channels.get(channel);
    if (!members) return;
    members.delete(socketId);
    if (members.size === 0) channels.delete(channel);
  }

  unsubscribeAll(appId, socketId) {
    const channels = this._channels(appId);
    for (const [name, members] of channels) {
      if (members.has(socketId)) {
        members.delete(socketId);
        if (members.size === 0) channels.delete(name);
      }
    }
  }

  members(appId, channel) {
    const channels = this._channels(appId);
    return channels.get(channel) || new Map();
  }

  channelNames(appId) {
    return Array.from(this._channels(appId).keys());
  }

  isSubscribed(appId, channel, socketId) {
    return this.members(appId, channel).has(socketId);
  }

  localConnectionCount(appId) {
    let count = 0;
    for (const [, members] of this._channels(appId)) count += members.size;
    return count;
  }

  // Sends to sockets connected to THIS process only.
  broadcastLocal(appId, channel, payload, exceptSocketId) {
    for (const [socketId, { socket }] of this.members(appId, channel)) {
      if (socketId === exceptSocketId) continue;
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    }
  }
}

module.exports = new ChannelManager();
