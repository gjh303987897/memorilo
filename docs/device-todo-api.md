# NOTE4 device TODO API

The sync server exposes a small device-facing Interface for native ESP-IDF firmware. It is intentionally separate from the desktop libp2p/Loro protocol.

## Provisioning

An authenticated browser session creates a device credential:

```http
POST /api/devices/todo-token
X-CSRF-Token: <browser-csrf-token>
Content-Type: application/json

{"deviceName":"NOTE4","expiresAt":<unix-ms>,"scopes":["todos:read","todos:write"]}
```

The response contains the bearer credential exactly once. Store it in NOTE4's protected storage. Credentials can be listed with `GET /api/devices/todo-tokens` and revoked with `POST /api/devices/todo-tokens/:deviceId/revoke`.

## Read-only synchronization

```http
GET /api/device/v1/todos?view=today&date=2026-09-01&limit=20
Authorization: Bearer memorilo-todo-v1....
```

`view=today` returns active tasks whose due date (or journal date) is the requested date. `view=all` returns all active tasks. Each item contains a stable opaque `id`, display text, status, date/time, and the nearest Todo parent. Each item also has a note `revision`; send that value as `baseRevision` when changing the item. The response has an account-wide revision in the top-level `revision`, suitable for cache validation.

The server returns an `ETag` for the top-level revision and answers `304 Not Modified` when `If-None-Match` matches. NOTE4 should keep its last successful snapshot and avoid an EPD refresh for a 304 response.

## Completion and reopening

```http
POST /api/device/v1/todo-actions
Authorization: Bearer memorilo-todo-v1....
Content-Type: application/json

{"operationId":"<uuid>","todoId":"<item-id>","action":"complete","baseRevision":"<item-revision>"}
```

`action` is `complete` or `reopen`. `operationId` is idempotent: retrying the same request returns the original result. A changed item produces `409 revision_conflict` with `currentRevision`; refresh the list before retrying. The server converts the action into a canonical Loro Note update and records it in the normal authoritative sync log, so desktop peers receive it through the existing sync protocol.

Use TLS, a device-specific credential, and the narrowest scope required. Do not embed a Memorilo account password in firmware.
