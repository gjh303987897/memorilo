# 05: Pull and admit authoritative TODO snapshots over HTTPS

**What to build:** NOTE4C fetches the authoritative snapshot immediately after an MQTT hint and on its periodic schedule, validates it, and admits only newer semantic data.

**Blocked by:** 02, 03, 04; fourcolor-firmware-integration #13

**Status:** completed

- [x] Use TLS/hostname validation, bearer authentication, bounded timeout, cancellation, and request limits.
- [x] Send ETag, view, local date, and limit; handle 200, 304, authentication failures, rate limits, server errors, and transport errors distinctly.
- [x] Reject malformed, oversized, cyclic, stale, duplicate, or out-of-order responses without replacing the last valid snapshot.
- [x] Run retries with bounded exponential backoff and keep radio/front-light policy power-aware.
