# Device TODO synchronization

Memorilo keeps NOTE4C TODO data read-only. The server's HTTPS snapshot is authoritative; MQTT carries only a small update hint. The device never opens a connection to the desktop.

## Paths

- Server to device: `mqtts://` notification topic, followed by an HTTPS `GET` with bearer authentication and `ETag`.
- Memorilo to device: desktop-initiated authenticated LAN `POST /v1/todos` after local TODO changes. The desktop may use `GET /v1/todos` to verify the cached revision.
- Device to desktop: no callback and no inbound desktop listener. BLE is used only for pairing and provisioning.

MQTT topics are device-scoped:

```text
memorilo/todos/<url-encoded-device-id>/todos/changed
```

The payload contains only `generatedAt`, `revision`, and `view`. It is safe to duplicate or lose a notification because the device falls back to bounded periodic HTTPS polling.

## Desktop LAN push

The optional `MEMORILO_NOTE4_TODO_DEVICES` environment variable configures automatic local pushes. It is a JSON array of `{ "address": "192.168.4.23", "deviceId": "..." }` entries. Local management bearer tokens remain in the encrypted credential store and are never placed in this variable or renderer state. The Device settings page can persist these targets; the environment variable remains a deployment-time fallback.

MQTT notifications are deliberately bounded hints. The server publishes only `generatedAt`, a printable revision (up to 128 characters), and `view`; the payload is capped at 512 UTF-8 bytes. The device always follows a notification with an authenticated HTTPS fetch and never treats MQTT as a TODO data store.

Local note changes are debounced and coalesced before a bounded snapshot is generated. Push failures update delivery status and do not fail or delay the editor mutation.

## Diagnostics and recovery

The device's authenticated `/v1/status` and `/v1/todos` responses expose the current revision, source, last successful timestamp, broker connectivity, last event, and a redacted error code. They never expose HTTPS, MQTT, Wi-Fi, or local-management credentials.

When the network is unavailable, the last valid snapshot remains on screen. A `304 Not Modified` and a semantically identical snapshot do not trigger an e-paper refresh. MQTT reconnects are independent of button input, BLE, local HTTP, and sleep handling.

The remaining hardware acceptance procedure is documented in
[`docs/device-todo-sync-hardware-acceptance.md`](device-todo-sync-hardware-acceptance.md).
