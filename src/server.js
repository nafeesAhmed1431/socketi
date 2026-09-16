const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const { WebSocketServer } = require('ws');
const config = require('./config');
const logger = require('./logger');
const httpApi = require('./httpApi');
const { getAdapter } = require('./adapter');
const { handleConnection, startHeartbeat } = require('./wsServer');

const app = express();
app.get('/', (req, res) => res.json({ status: 'ok', name: 'socketi', nodeId: config.nodeId }));
app.use(httpApi);

const useTls = config.tls.cert && config.tls.key;
const server = useTls
  ? https.createServer({ cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key) }, app)
  : http.createServer(app);

const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes });

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/app\/([^/?]+)/);
  if (!match) {
    socket.destroy();
    return;
  }
  const appKey = match[1];
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws, req, appKey);
  });
});

let heartbeat;

async function start() {
  const adapter = getAdapter();
  await adapter.init();

  heartbeat = startHeartbeat(wss);

  server.listen(config.port, config.host, () => {
    logger.info({
      port: config.port,
      tls: useTls,
      adapter: config.adapter,
      apps: config.apps.map((a) => a.key),
      nodeId: config.nodeId,
    }, `socketi listening on ${useTls ? 'wss' : 'ws'}://${config.host}:${config.port}`);
  });
}

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  clearInterval(heartbeat);

  wss.clients.forEach((socket) => socket.close(1001, 'Server shutting down'));

  await new Promise((resolve) => server.close(resolve));
  await getAdapter().close();

  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

start().catch((err) => {
  logger.error({ err: err.message }, 'failed to start');
  process.exit(1);
});
