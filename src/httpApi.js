const express = require('express');
const config = require('./config');
const { getAdapter } = require('./adapter');
const { verifyRequestSignature } = require('./signature');

const router = express.Router();

router.use(express.json({ limit: '256kb' }));

router.get('/health', (req, res) => {
  res.json({ status: 'ok', nodeId: config.nodeId, adapter: config.adapter });
});

function checkAuth(req, res, next) {
  const app = config.findById(req.params.appId);
  if (!app) return res.status(404).json({ error: 'App not found' });

  const query = { ...req.query };
  if (query.auth_key !== app.key) {
    return res.status(401).json({ error: 'Invalid auth_key' });
  }

  const result = verifyRequestSignature({
    secret: app.secret,
    method: req.method,
    path: req.path,
    query,
    toleranceSec: config.authTimestampToleranceSec,
  });
  if (!result.ok) return res.status(401).json({ error: `Invalid signature: ${result.reason}` });

  req.app_ = app;
  next();
}

async function triggerEvent(app, channels, eventName, data, socketId) {
  const adapter = getAdapter();
  for (const channel of channels) {
    await adapter.broadcast(app, channel, { event: eventName, channel, data }, socketId);
  }
}

router.post('/apps/:appId/events', checkAuth, async (req, res, next) => {
  try {
    const { name, data, channel, channels, socket_id: socketId } = req.body;
    const targetChannels = channels || (channel ? [channel] : []);
    if (!name || targetChannels.length === 0) {
      return res.status(400).json({ error: 'name and channel(s) required' });
    }
    await triggerEvent(req.app_, targetChannels, name, data, socketId);
    res.json({});
  } catch (err) {
    next(err);
  }
});

router.post('/apps/:appId/batch_events', checkAuth, async (req, res, next) => {
  try {
    const { batch } = req.body;
    if (!Array.isArray(batch)) return res.status(400).json({ error: 'batch required' });
    for (const item of batch) {
      const targetChannels = item.channels || (item.channel ? [item.channel] : []);
      await triggerEvent(req.app_, targetChannels, item.name, item.data, item.socket_id);
    }
    res.json({});
  } catch (err) {
    next(err);
  }
});

router.get('/apps/:appId/channels', checkAuth, async (req, res, next) => {
  try {
    const channels = await getAdapter().channelList(req.app_, req.query.filter_by_prefix);
    res.json({ channels });
  } catch (err) {
    next(err);
  }
});

router.get('/apps/:appId/channels/:channel', checkAuth, async (req, res, next) => {
  try {
    const info = await getAdapter().channelInfo(req.app_, req.params.channel);
    res.json(info);
  } catch (err) {
    next(err);
  }
});

router.get('/apps/:appId/channels/:channel/users', checkAuth, async (req, res, next) => {
  try {
    const users = await getAdapter().presenceUsers(req.app_, req.params.channel);
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

router.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal error' });
});

module.exports = router;
