# Firmware acceptance budgets

These budgets turn firmware growth into an explicit review decision. They are
measured from the release `real-display` artifact and the `DIAG` records emitted
by the same build. A stage may tighten a later limit after measurements, but it
must not silently exceed the active row.

| Stage | Tickets | Application image | ELF | Minimum free internal RAM | Minimum free PSRAM | Main-task stack margin | Full refresh |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Foundation | 01–08 | 600 KiB | 1.5 MiB | 280 KiB | 7.75 MiB | 1.5 KiB | 27 s |
| Provisioning | 09–12, 19 | 1.25 MiB | 2.25 MiB | 220 KiB | 7 MiB | 1.5 KiB | 27 s |
| Connected content | 13–15, 20 | 2.25 MiB | 4 MiB | 160 KiB | 6 MiB | 1.5 KiB | 27 s |
| Audio and update | 16–18 | 3 MiB per OTA slot | 6 MiB | 128 KiB | 4 MiB | 1.5 KiB | 27 s |

The image limit must also fit the active partition table. Crossing a stage is
not permission to enlarge a partition silently; partition and rollback policy
belong to the ticket that requires them.

The release preparation path uses ESP-IDF's official partition generator and
the checked-in CSV to reserve a 3 MiB factory application partition while
keeping the original `0x10000` application and NVS offsets stable. This is not
an OTA design: ticket 18 must replace it only after update authority, signing,
and rollback behavior are decided. Artifact checks reject a stale application
image and reject any image larger than the actual binary partition table.

## Power review

The repository cannot infer supply current from USB serial. Every physical
acceptance pass records stable idle, refresh average/peak, and post-refresh
current at the device input. Until the first meter-backed baseline exists, the
release gate requires an explicit acknowledgement instead of fabricating a
number. After that baseline is recorded, later stages must stay within 10% for
idle/post-refresh and 15% for refresh peak unless the relevant ticket documents
the reason and expected user-visible benefit.

## Reproduction

Build with the canonical ESP-IDF path, capture a boot and one refresh with the
separate monitor command, then run:

```powershell
.\apps\note4c-firmware\tools\check-firmware-budgets.ps1 `
  -Stage provisioning `
  -DiagnosticsLog .\firmware-diag.log `
  -AcknowledgeExternalPowerReview
```

The command fails on artifact or parsed runtime regressions. Missing runtime or
power evidence also fails unless the corresponding acknowledgement switch is
present, making a manual review visible in CI or release notes.
