# 06: Integrate push and pull results with Application display scheduling

**What to build:** Snapshot changes from either MQTT-triggered pulls or periodic pulls update the Application without locking input or interrupting an e-paper refresh.

**Blocked by:** 02, 05; fourcolor-firmware-integration #03

**Status:** completed

- [x] Dispatch a typed synchronization result only for a newly admitted semantic model.
- [x] Skip identical snapshots and 304 responses; queue and coalesce changes that arrive during refresh.
- [x] Keep buttons, BLE, local HTTP, and sleep policy responsive while network or display work is pending.
- [x] Never enable the front light for background synchronization.
