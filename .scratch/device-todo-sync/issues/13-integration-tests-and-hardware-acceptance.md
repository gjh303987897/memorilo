# 13: Verify the dual-path synchronization workflow on hardware

**What to build:** Automated tests, documentation, and a NOTE4C smoke test prove that MQTT notifications accelerate updates while HTTPS and local HTTP remain reliable boundaries.

**Blocked by:** 01–12

**Status:** in-progress

- [x] Test projection validation, revision ordering, immediate HTTPS fetch, periodic fallback, ETag/304, cache migration, and MQTT topic/payload bounds.
- [x] Test six-row pagination, no row-action semantics, BLE configuration, LAN read-only export, official assets storage, and secret redaction.
- [ ] On hardware, verify application-triggered notification, server-triggered notification, offline cache, button input during refresh, four-color full-frame fallback for small changes, and front-light state.
- [x] Update architecture, provisioning, LAN API, MQTT topic, and troubleshooting documentation.

The reproducible procedure and evidence format are documented in
[`docs/device-todo-sync-hardware-acceptance.md`](../../docs/device-todo-sync-hardware-acceptance.md).
