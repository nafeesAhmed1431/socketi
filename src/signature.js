const crypto = require('crypto');

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function verifyChannelAuth({ secret, socketId, channel, signature, channelData }) {
  if (!signature) return false;
  const base = channelData ? `${socketId}:${channel}:${channelData}` : `${socketId}:${channel}`;
  const expected = hmac(secret, base);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signChannel({ secret, socketId, channel, channelData }) {
  const base = channelData ? `${socketId}:${channel}:${channelData}` : `${socketId}:${channel}`;
  return hmac(secret, base);
}

function verifyRequestSignature({ secret, method, path, query, toleranceSec = 600 }) {
  if (!query.auth_signature || !query.auth_key || !query.auth_timestamp) {
    return { ok: false, reason: 'missing_auth_params' };
  }

  const timestamp = parseInt(query.auth_timestamp, 10);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const params = { ...query };
  delete params.auth_signature;
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const stringToSign = [method.toUpperCase(), path, sorted].join('\n');
  const expected = hmac(secret, stringToSign);

  const a = Buffer.from(expected);
  const b = Buffer.from(query.auth_signature);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return valid ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

module.exports = { hmac, verifyChannelAuth, signChannel, verifyRequestSignature };
