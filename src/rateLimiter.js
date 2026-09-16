// Fixed-window rate limiter per socket, in-process (per-instance) only.
// Good enough since it bounds a single connection's blast radius regardless
// of which node it landed on.
class RateLimiter {
  constructor(maxMessages, windowMs) {
    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
    this.buckets = new Map(); // socketId -> { count, resetAt }
  }

  check(socketId) {
    const now = Date.now();
    let bucket = this.buckets.get(socketId);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(socketId, bucket);
    }
    bucket.count += 1;
    return bucket.count <= this.maxMessages;
  }

  drop(socketId) {
    this.buckets.delete(socketId);
  }
}

module.exports = RateLimiter;
