# Device TODO synchronization

Memorilo keeps NOTE4C TODO data read-only. The device supports two delivery
paths, but one device must use only one path at a time: configure HTTPS (with a
device token) for server snapshots, or leave HTTPS unconfigured for desktop
LAN/BLE/Serial pushes. When HTTPS is configured, the firmware ignores local
pushes so the two projections cannot overwrite one another. MQTT carries only a
small HTTPS refresh hint. The device never opens a connection to the desktop.

## Paths

- Server to device: when `MEMORILO_SYNC_SERVER_MQTT_TODO_BROKER_URL` is configured, an `mqtts://` notification topic is published first, followed by an HTTPS `GET` with bearer authentication and `ETag`; without a broker, the device uses bounded periodic HTTPS polling.
- Memorilo to device: desktop-initiated authenticated LAN `POST /v1/todos` after local TODO changes, or a direct TODO snapshot push over an authenticated BLE or USB Serial provisioning session.
- Device to desktop: no callback and no inbound desktop listener. BLE and USB Serial are outbound provisioning transports; they carry the same bounded snapshot contract as LAN.

When HTTPS is not configured and a device is connected from Device Settings,
Desktop immediately sends the current snapshot over the selected BLE or USB
Serial session. An empty snapshot is intentional: it clears any TODOs retained
in device storage. LAN, BLE, and Serial use the desktop projection; HTTPS uses
the server projection. They are mutually exclusive on the device.

MQTT topics are device-scoped:

```text
memorilo/todos/<url-encoded-device-id>/todos/changed
```

The payload contains only `generatedAt`, `revision`, and `view`. It is safe to duplicate or lose a notification because the device falls back to bounded periodic HTTPS polling.

## Desktop LAN push

The optional `MEMORILO_NOTE4_TODO_DEVICES` environment variable configures automatic local pushes. It is a JSON array of `{ "address": "192.168.4.23", "deviceId": "..." }` entries. Literal RFC1918 or link-local IPv4 values may include a port; the generated `memorilo-*.local` mDNS names are also accepted for device discovery. Local management bearer tokens remain in the encrypted credential store and are never placed in this variable or renderer state. The Device settings page can persist these targets; the environment variable remains a deployment-time fallback. mDNS and user-entered addresses are not cryptographically bound to a device identity, so verify the target before sending a token-bearing request.

MQTT notifications are deliberately bounded hints. The server publishes only `generatedAt`, a printable revision (up to 128 characters), and `view`; the payload is capped at 512 UTF-8 bytes. The device always follows a notification with an authenticated HTTPS fetch and never treats MQTT as a TODO data store.

Local note changes are debounced and coalesced before a bounded snapshot is generated. Push failures update delivery status and do not fail or delay the editor mutation.
Only unfinished (`todo` and `doing`) tasks are sent, and completion filtering
happens before the 64-item device limit. Changes arriving through P2P also
schedule a debounced local push after they are applied.

## Diagnostics and recovery

The device's authenticated `/v1/status` and `/v1/todos` responses expose the current revision, source, last successful timestamp, broker connectivity, last event, and a redacted error code. They never expose HTTPS, MQTT, Wi-Fi, or local-management credentials.

When the network is unavailable, the last valid snapshot remains on screen. A `304 Not Modified` and a semantically identical snapshot do not trigger an e-paper refresh. MQTT reconnects are independent of button input, BLE, local HTTP, and sleep handling.

The remaining hardware acceptance procedure is documented in
[`docs/device-todo-sync-hardware-acceptance.md`](device-todo-sync-hardware-acceptance.md).
