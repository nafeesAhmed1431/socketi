const crypto = require('crypto');
const config = require('./config');
const channelManager = require('./channelManager');
const { verifyChannelAuth } = require('./signature');
const { getAdapter } = require('./adapter');
const RateLimiter = require('./rateLimiter');
const webhooks = require('./webhooks');
const logger = require('./logger');

const rateLimiter = new RateLimiter(config.rateLimit.messagesPerWindow, config.rateLimit.windowMs);

function socketMessage(event, data, channel) {
  const payload = { event, data: JSON.stringify(data) };
  if (channel) payload.channel = channel;
  return payload;
}

function send(socket, event, data, channel) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(socketMessage(event, data, channel)));
}

function isPresence(channel) {
  return channel.startsWith('presence-');
}

function isPrivate(channel) {
  return channel.startsWith('private-') || isPresence(channel);
}

function handleConnection(socket, req, appKey) {
  const app = config.findByKey(appKey);
  if (!app) {
    socket.close(4001, 'App key not found');
    return;
  }

  const adapter = getAdapter();
  if (Number.isFinite(app.maxConnections) && adapter.connectionCount(app) >= app.maxConnections) {
    socket.close(4004, 'Over connection quota');
    return;
  }

  const socketId = `${Math.floor(Math.random() * 1e10)}.${Math.floor(Math.random() * 1e10)}`;
  socket.socketId = socketId;
  socket.appId = app.id;
  socket.isAlive = true;

  send(socket, 'pusher:connection_established', {
    socket_id: socketId,
    activity_timeout: 30,
  });

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => {
    if (!rateLimiter.check(socketId)) {
      send(socket, 'pusher:error', { message: 'Rate limit exceeded', code: 4301 });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(app, socket, msg).catch((err) => {
      logger.error({ err: err.message, appId: app.id }, 'message handling failed');
    });
  });

  socket.on('close', () => {
    rateLimiter.drop(socketId);
    handleDisconnect(app, socket).catch((err) => {
      logger.error({ err: err.message, appId: app.id }, 'disconnect handling failed');
    });
  });
}

async function handleMessage(app, socket, msg) {
  const { event, data, channel } = msg;

  switch (event) {
    case 'pusher:ping':
      send(socket, 'pusher:pong', {});
      break;

    case 'pusher:subscribe':
      await handleSubscribe(app, socket, data || {});
      break;

    case 'pusher:unsubscribe':
      await handleUnsubscribe(app, socket, (data || {}).channel);
      break;

    default:
      if (event && event.startsWith('client-') && channel) {
        if (!app.enableClientMessages) return;
        if (channelManager.isSubscribed(app.id, channel, socket.socketId)) {
          await getAdapter().broadcast(app, channel, { event, channel, data }, socket.socketId);
        }
      }
  }
}

async function handleSubscribe(app, socket, data) {
  const { channel, auth, channel_data: channelData } = data;
  if (!channel) return;

  if (isPrivate(channel)) {
    const expectedSignature = auth ? auth.split(':')[1] : null;
    const ok = verifyChannelAuth({
      secret: app.secret,
      socketId: socket.socketId,
      channel,
      signature: expectedSignature,
      channelData,
    });
    if (!ok) {
      send(socket, 'pusher:error', { message: `Auth failed for channel ${channel}`, code: 4009 });
      return;
    }
  }

  let memberData = null;
  if (isPresence(channel) && channelData) {
    try {
      memberData = JSON.parse(channelData);
    } catch {
      memberData = null;
    }
  }

  const adapter = getAdapter();

  if (isPresence(channel)) {
    const existing = await adapter.channelInfo(app, channel);
    if (existing.subscription_count >= app.maxPresenceMembers) {
      send(socket, 'pusher:error', { message: `Channel ${channel} is full`, code: 4100 });
      return;
    }
  }

  const result = await adapter.subscribe(app, channel, socket.socketId, socket, memberData);

  if (isPresence(channel)) {
    send(socket, 'pusher_internal:subscription_succeeded', {
      presence: { ids: result.ids, hash: result.hash, count: result.count },
    }, channel);

    if (memberData) {
      await adapter.broadcast(app, channel, {
        event: 'pusher_internal:member_added',
        channel,
        data: { user_id: memberData.user_id, user_info: memberData.user_info },
      }, socket.socketId);
      webhooks.dispatch(app, 'member_added', { channel, user_id: memberData.user_id });
    }
  } else {
    send(socket, 'pusher_internal:subscription_succeeded', {}, channel);
  }
}

async function handleUnsubscribe(app, socket, channel) {
  if (!channel) return;
  if (!channelManager.isSubscribed(app.id, channel, socket.socketId)) return;

  const adapter = getAdapter();
  const { memberData } = await adapter.unsubscribe(app, channel, socket.socketId);

  if (isPresence(channel) && memberData) {
    await adapter.broadcast(app, channel, {
      event: 'pusher_internal:member_removed',
      channel,
      data: { user_id: memberData.user_id },
    });
    webhooks.dispatch(app, 'member_removed', { channel, user_id: memberData.user_id });
  }
}

async function handleDisconnect(app, socket) {
  const channels = channelManager.channelNames(app.id);
  for (const channel of channels) {
    if (channelManager.isSubscribed(app.id, channel, socket.socketId)) {
      await handleUnsubscribe(app, socket, channel);
    }
  }
}

function startHeartbeat(wss) {
  return setInterval(() => {
    wss.clients.forEach((socket) => {
      if (socket.isAlive === false) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, config.heartbeatIntervalMs);
}

module.exports = { handleConnection, startHeartbeat, send };
