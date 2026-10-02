# 01: Define the read-only TODO projection and dual-ingress contract

**What to build:** A versioned contract and fixtures that let the server, Memorilo, and NOTE4C exchange the same bounded TODO snapshot. The contract distinguishes client-initiated LAN snapshot push, server MQTT update notifications, HTTPS retrieval, and LAN read-only export.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] Define stable fields, opaque IDs, statuses, parent references, dates/times, `today`/`all` semantics, and size/item limits.
- [x] Define monotonic revision and duplicate/out-of-order admission rules for client LAN pushes, MQTT-triggered fetches, periodic pulls, and exports.
- [x] Explicitly exclude completion, reopen, edit, delete, reorder, row actions, and device-originated TODO mutations.
- [x] Provide representative valid, empty, malformed, oversized, and cyclic fixtures.
