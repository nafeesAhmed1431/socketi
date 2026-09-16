# socketi

Pusher-protocol compatible WebSocket server (Node.js, `ws` + `express`), built to run as a single instance or scaled out horizontally behind a load balancer.

## Run (local)

```
npm install
cp .env.example .env    # edit as needed
npm start
```

Server listens on `ws://localhost:6001` (HTTP + WS on same port).

## Run (Docker, cluster-ready)

```
docker compose up --build
```

Brings up `socketi` + `redis`, with the app already configured to use the Redis adapter. Scale with `docker compose up --scale socketi=3` behind your own load balancer — all instances share channel/presence state via Redis.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `SOCKETI_APP_ID` / `SOCKETI_APP_KEY` / `SOCKETI_APP_SECRET` | `app1` / `app1key` / `app1secret` | Single-app config |
| `SOCKETI_APPS_JSON` / `SOCKETI_APPS_FILE` | - | Multi-app config, JSON array of `{id, key, secret, maxConnections?, enableClientMessages?, maxPresenceMembers?, webhooks?}` |
| `SOCKETI_PORT` / `SOCKETI_HOST` | `6001` / `0.0.0.0` | Listen address |
| `SOCKETI_ADAPTER` | `local` | `local` (single process) or `redis` (cluster) |
| `SOCKETI_REDIS_URL` | `redis://127.0.0.1:6379` | Used when `SOCKETI_ADAPTER=redis` |
| `SOCKETI_TLS_CERT` / `SOCKETI_TLS_KEY` | - | Serve `https`/`wss` when both are set |
| `SOCKETI_MAX_PAYLOAD_KB` | `64` | Max WS message size |
| `SOCKETI_AUTH_TOLERANCE_SEC` | `600` | Max allowed clock drift for REST `auth_timestamp` |
| `SOCKETI_RATE_LIMIT_MSGS` / `SOCKETI_RATE_LIMIT_WINDOW_MS` | `50` / `10000` | Per-socket message rate limit |
| `SOCKETI_HEARTBEAT_MS` | `30000` | WS ping interval / dead-connection reap |
| `SOCKETI_NODE_ID` | random | Identifies this instance in logs and the Redis relay |
| `SOCKETI_LOG_LEVEL` | `info` | pino log level |

See [.env.example](.env.example) for the full list.

## Client connect

```
ws://localhost:6001/app/app1key
```

Use any Pusher-compatible client (e.g. `pusher-js`) pointed at this host/port with `useTLS` matching whether TLS is configured.

## REST API

- `GET /health` — liveness/readiness, no auth
- `POST /apps/:appId/events`
- `POST /apps/:appId/batch_events`
- `GET /apps/:appId/channels`
- `GET /apps/:appId/channels/:channel`
- `GET /apps/:appId/channels/:channel/users`

Auth: standard Pusher REST signature (`auth_key`, `auth_timestamp`, `auth_version`, `auth_signature` query params, HMAC-SHA256 over `METHOD\npath\nsorted_query`, timing-safe compare, timestamp checked against `SOCKETI_AUTH_TOLERANCE_SEC`).

## Channels

Supports public, `private-*`, and `presence-*` channels, client events (`client-*`, toggled per-app via `enableClientMessages`), and `pusher:ping`/`pusher:pong` heartbeat.

## Webhooks

Configure per app:

```json
{ "id": "app1", "key": "app1key", "secret": "app1secret",
  "webhooks": [{ "url": "https://example.com/hooks", "secret": "optional-override", "events": ["channel_occupied", "channel_vacated", "member_added", "member_removed"] }] }
```

`events` omitted = all events. Fires `channel_occupied` / `channel_vacated` (cluster-wide, first/last subscriber) and `member_added` / `member_removed` (presence channels). POST body signed with `X-Socketi-Signature` (HMAC-SHA256 of the JSON body).

## Scaling notes

- `local` adapter: single process, in-memory — fastest, no extra infra, doesn't survive a restart or run behind more than one instance.
- `redis` adapter: channel membership, presence data, and cross-instance broadcast relay all go through Redis (`ioredis`). Safe to run N instances behind a load balancer with sticky-less routing — a socket only needs to reach *any* instance.
- Rate limiting and connection caps (`maxConnections`) are enforced per-instance, not cluster-wide.

## Production checklist

- Put a reverse proxy / load balancer in front (TLS termination there, or set `SOCKETI_TLS_CERT`/`KEY` to terminate in-process).
- Use `SOCKETI_ADAPTER=redis` once you run more than one instance.
- Set real per-app secrets via `SOCKETI_APPS_JSON`/`SOCKETI_APPS_FILE`, not the `.env.example` defaults.
- `SIGTERM`/`SIGINT` trigger a graceful drain (closes sockets, flushes Redis connections) — make sure your orchestrator sends `SIGTERM` and gives it a few seconds before `SIGKILL`.
- `GET /health` for liveness/readiness probes.
