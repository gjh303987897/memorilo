# 12: Expose synchronization diagnostics and status

**What to build:** The device status and diagnostics surfaces make MQTT notifications, HTTPS pulls, cached data, and failures understandable without exposing secrets.

**Blocked by:** 04, 05, 08; fourcolor-firmware-integration #07, #19

**Status:** completed

- [x] Distinguish application notification, server pull, 304/no-change, empty list, offline cache, authentication failure, and retrying states.
- [x] Show last successful revision, source, timestamp, broker connectivity, and a redacted error code.
- [x] Keep diagnostics updates low-frequency and compatible with the existing partial-refresh and front-light policy.
