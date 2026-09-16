const crypto = require('crypto');
const logger = require('./logger');

function dispatch(app, eventName, data) {
  const hooks = app.webhooks || [];
  if (hooks.length === 0) return;

  const body = JSON.stringify({
    time_ms: Date.now(),
    events: [{ name: eventName, ...data }],
  });

  for (const hook of hooks) {
    if (hook.events && !hook.events.includes(eventName)) continue;
    const signature = crypto.createHmac('sha256', hook.secret || app.secret).update(body).digest('hex');

    fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Socketi-Key': app.key,
        'X-Socketi-Signature': signature,
      },
      body,
    }).catch((err) => {
      logger.warn({ err: err.message, url: hook.url, appId: app.id }, 'webhook dispatch failed');
    });
  }
}

module.exports = { dispatch };
