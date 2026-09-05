# 02: Persist the device TODO cache and sync configuration

**What to build:** NOTE4C keeps the most recent valid read-only snapshot and synchronization configuration across reboot and temporary outages.

**Blocked by:** 01; fourcolor-firmware-integration #06

**Status:** completed

- [x] Persist snapshot, revision, source, ETag, last-success time, and redacted sync outcome with bounded storage and atomic recovery.
- [x] Persist URL, token, enable flag, interval, and view with validation and deterministic migration from demo data.
- [x] Retain the last valid snapshot when a newer payload or persistence attempt fails.
- [x] Expose page index state separately from TODO data; no per-row selection state exists.
