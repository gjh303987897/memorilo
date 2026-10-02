# 04: Publish and receive MQTT TODO update notifications

**What to build:** The server publishes a small, authenticated notification when the canonical TODO projection changes, and NOTE4C receives it to trigger an immediate HTTPS fetch. Memorilo local changes use the separate direct LAN push ticket.

**Blocked by:** 01, 02

**Status:** completed

- [x] Define per-device topics, TLS credentials, ACLs, bounded reconnect/backoff, and QoS for update hints.
- [x] Publish only revision/view/date metadata (never task actions); duplicate notifications are harmless.
- [x] Keep the device subscription cancellable and independent from input, BLE, display, and sleep handling.
- [x] Fall back to periodic HTTPS polling after broker or Wi-Fi loss.
- [x] Add broker mock integration coverage for connect/reconnect, publish loss, and duplicate notifications.
