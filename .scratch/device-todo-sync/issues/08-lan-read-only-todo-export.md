# 08: Expose an authenticated LAN read-only TODO export

**What to build:** A local HTTP client initiates a read of the device's cached TODO snapshot and synchronization metadata without requiring the device to connect back to the client or mutate tasks/configuration.

**Blocked by:** 02; fourcolor-firmware-integration #13

**Status:** completed

- [x] Return the snapshot, revision, source, last-success time, cache availability, and redacted status.
- [x] Keep the interaction client-initiated so desktop firewall policy needs no inbound connection to the client.
- [x] Enforce authentication, bounded responses, and read-only authorization independently from management commands.
- [x] Never include bearer credentials or accept completion, edit, delete, reorder, or snapshot-write operations through this export surface.
