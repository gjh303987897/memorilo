# NOTE4C device TODO synchronization

Status: ready-for-agent

## Problem Statement

The NOTE4C firmware can render a local `TodoModel` and Memorilo already exposes a device-facing TODO API, but the two are not connected. The device therefore shows stale/demo tasks unless a separate, manual data path is added. The device must remain usable while Wi-Fi requests and the approximately 20-second e-paper refresh are in progress, and it must avoid waking the display for unchanged data.

The product also needs a clear communication boundary. BLE is already the user-mediated provisioning channel, while local HTTP is used for device status, gallery management, and commands. Replacing every channel with MQTT would add a broker, long-lived connections, topic authorization, offline delivery, and extra power/RAM cost without improving a read-only task list whose display refresh is intentionally slow.

## Solution

Keep the existing channel responsibilities and add MQTT update notifications plus an HTTPS snapshot client to the NOTE4C network runtime:

- BLE remains the pairing/configuration channel. Memorilo's device settings page writes the sync server URL, device TODO bearer token, enable flag, polling interval, and list view through the existing authenticated provisioning flow.
- MQTT is the timely server-notification channel. The server publishes a bounded TODO-change notification; the device subscribes while Wi-Fi is online and immediately fetches the authoritative snapshot over HTTPS.
- Memorilo local changes use a direct, authenticated LAN HTTP push from the client to the device. The device never opens a LAN connection to the client, which avoids requiring an inbound firewall exception on the desktop.
- Local HTTP remains the LAN management channel for status, gallery, diagnostics, and read-only TODO export.
- When Wi-Fi is online and TODO sync is enabled, the firmware also periodically calls `GET /api/device/v1/todos` over HTTPS with the device credential. It sends `If-None-Match` and retains the last successful snapshot and revision. Periodic pull is the fallback when MQTT is unavailable.
- HTTPS retrieval runs on a bounded worker separate from the network/control loop. MQTT hints and the timer coalesce into one in-flight request; responses from an older Wi-Fi/BLE configuration generation are discarded.
- A `304 Not Modified`, an identical mapped `TodoModel`, or a transient failure must not trigger an e-paper refresh. A changed snapshot from a client LAN push, an MQTT-triggered fetch, or a periodic pull is passed to `ApplicationCommand::TodosSynced`; the application decides whether a display update is needed.
- TODO data is read-only on the device. No complete/reopen actions or per-row selection are sent back to the server.
- The sync task is cancellable and bounded. Input handling, BLE, local management, and sleep policy continue while a request or display update is outstanding. Retries use bounded exponential backoff and do not keep the front light on.

MQTT carries only update notifications in this phase, not task actions. The device still fetches the authoritative snapshot over HTTPS, and periodic HTTPS polling remains the recovery path after broker or Wi-Fi outages.

## User Stories

1. As a Memorilo user, I want to configure a NOTE4C from the existing device settings page, so that I do not need a second setup application.
2. As a Memorilo user, I want to enter or paste the sync server URL, so that self-hosted and proxied deployments work.
3. As a Memorilo user, I want to provision a device-specific TODO token over authenticated BLE, so that my account password is never stored on the device.
4. As a Memorilo user, I want the token to be shown only once by the server and redacted in UI/logs, so that accidental disclosure is less likely.
5. As a Memorilo user, I want to enable or disable TODO synchronization independently of Wi-Fi and local management, so that I control network usage.
6. As a Memorilo user, I want to choose today's tasks or all active tasks, so that the display matches my workflow.
7. As a Memorilo user, I want a configurable polling interval with a safe minimum and maximum, so that freshness and battery life can be balanced.
8. As a NOTE4C owner, I want the device to retain the last successful TODO snapshot through a reboot or temporary outage, so that the TODO page is still useful offline.
9. As a NOTE4C owner, I want the device to use the local timezone when requesting the `today` view, so that date filtering matches the displayed day.
10. As a NOTE4C owner, I want expired, revoked, or invalid credentials to produce a clear sync error without blocking other device features, so that I can recover through BLE.
11. As a NOTE4C owner, I want Wi-Fi loss to stop network work promptly and resume with backoff after reconnection, so that the device does not waste power retrying a dead link.
12. As a NOTE4C owner, I want TLS certificate and hostname validation, so that TODO data and credentials are protected in transit.
13. As a NOTE4C owner, I want a 304 response to leave the display untouched, so that unchanged data does not consume a 20-second refresh.
14. As a NOTE4C owner, I want an equivalent TODO payload to be recognized as unchanged even if JSON ordering or generation time differs, so that only semantic changes refresh the panel.
15. As a NOTE4C owner, I want changed TODO data to appear after the current display operation completes, so that buttons remain responsive and no refresh is interrupted unsafely.
16. As a NOTE4C owner, I want to navigate TODO pages with the existing short-press up/down behavior, so that a large list remains usable without row actions.
17. As a NOTE4C owner, I want completed tasks omitted according to the server's active-task contract, so that the display is not filled with historical work.
18. As a NOTE4C owner, I want task status and indentation preserved, so that parent/child context remains understandable on the e-paper page.
19. As a NOTE4C owner, I want due dates and times rendered when present and blank when absent, so that malformed optional metadata does not crash rendering.
20. As a NOTE4C owner, I want an empty server list to be distinguishable from a failed sync, so that I know whether there are no tasks or the device is offline.
21. As a NOTE4C owner, I want sync activity and the last successful revision visible in diagnostics/status, so that connectivity can be verified without inspecting logs.
22. As a NOTE4C owner, I want local gallery, status, and sleep commands to continue working while TODO sync runs, so that synchronization is not a global lock.
23. As a NOTE4C owner, I want the front light to remain off except for the existing user-visible illumination policy, so that background synchronization does not drain the battery.
24. As a NOTE4C owner, I want a failed display refresh to retain the previous TODO snapshot and retry safely, so that a transient panel fault does not lose data.
25. As a NOTE4C owner, I want duplicate or out-of-order responses not to roll the list back, so that a slow request cannot overwrite newer data.
26. As a developer, I want the sync client to emit a typed result at the network/application boundary, so that transport errors do not leak into rendering code.
27. As a developer, I want server opaque IDs to remain stable in the firmware model, so that equality checks and future actions do not depend on a lossy hash.
28. As a developer, I want old persisted local/demo TODO data to migrate deterministically, so that a firmware update does not invalidate the storage blob.
29. As an operator, I want existing server token scopes and revocation to remain authoritative, so that no new account-level authentication path is introduced.
30. As an operator, I want request size, item count, timeout, and retry bounds enforced on the device, so that a compromised or misconfigured server cannot exhaust memory or keep the radio awake indefinitely.
31. As a product owner, I want MQTT to carry only bounded TODO update notifications, so that server and client changes reach the device quickly without making the broker a second TODO database.
32. As a product owner, I want HTTPS polling and local HTTP management to remain available, so that broker outages, gallery transfers, and diagnostics have a reliable fallback.
33. As a desktop user, I want the client to initiate every LAN request to the device, so that Windows firewall policy does not require an inbound listener or device callback on the client.

## Implementation Decisions

- Add a `TodoSyncConfig` section to the persistent device configuration. It contains `enabled`, an HTTPS base URL, a secret device token, a polling interval, `view` (`today` or `all`), and the device-scoped MQTT notification endpoint/credentials. Secrets use the same redacted storage treatment as Wi-Fi and local-management tokens and are never included in public configuration responses.
- Bump the device configuration schema/capability advertisement for the new fields while preserving the existing provisioning revision and stale-revision checks. Older clients that do not send the new fields leave the current sync configuration unchanged.
- Extend the BLE apply envelope with a typed TODO-sync patch (set/clear URL, set/clear token, enable flag, interval, and view). Validate HTTPS URLs, token length/ASCII constraints, and interval bounds before committing. A clear-token operation must be explicit and mutually exclusive with setting a token.
- Memorilo's device settings UI owns these controls and uses the existing device provisioning service. It must not echo the bearer token in ordinary read responses, analytics, or renderer logs. Token issuance continues to use the server's existing `todos:read` scope; `todos:write` is not requested for this read-only firmware.
- Implement a `TodoSyncClient` behind the network runtime boundary. It runs only while Wi-Fi is connected, uses a bounded HTTPS client timeout, sends `Authorization: Bearer`, `view`, local `date` for `today`, and a bounded `limit`, and stores the response ETag and top-level revision after a successful 200 response. An MQTT notification triggers the same fetch path immediately; the timer remains the fallback.
- Handle HTTP outcomes explicitly: 200 parses and validates the snapshot; 304 reports `Unchanged`; 401/403 report `CredentialRejected`; 429/5xx and transport/TLS failures report retryable errors; other 4xx responses report non-retryable configuration errors. Retryable errors use bounded exponential backoff with jitter and reset after a successful response.
- Validate the snapshot before admission: maximum body size and item count, required string bounds, valid `YYYY-MM-DD` dates and `HH:MM` times, known status values, and valid parent references. Invalid payloads are rejected without replacing the last good snapshot.
- Map server statuses `todo`, `in-progress`, and `done` to firmware `Open`, `Doing`, and `Done`. The server currently omits done items for both supported views; the client still accepts `done` for forward compatibility. Map `text` to `title`, due date/time to the firmware display string, and derive indentation from the parent relationship after validating that the graph is acyclic and bounded.
- Replace the firmware-only numeric TODO identity with a bounded opaque string identity (or an equivalent persisted source-ID field) so server IDs remain stable. Provide a deterministic migration for existing numeric demo IDs and reject overlong IDs. Equality of the complete mapped `TodoModel`, not server `generatedAt`, determines whether a display update is necessary.
- Keep the existing application command seam: the network runtime emits a typed synchronization result, and the main/application layer dispatches `ApplicationCommand::TodosSynced` only for a newly admitted model. The application retains its current page-selection clamping and no-op behavior for equal models.
- Queue a pending display update rather than blocking input or cancelling an in-progress e-paper operation. Apply the newest admitted model after the current refresh completes; coalesce multiple changes into one refresh. Never turn on the front light as part of background sync.
- Persist the last successful TODO model, ETag, revision, and last-sync outcome subject to the existing blob size limits. If persistence is unavailable, keep the model in RAM and expose a diagnostic error; do not discard a valid screen state.
- Keep local HTTP management available. Its status response may expose sync phase, last-success timestamp, revision, notification connectivity, and redacted error code, but never the URL credentials or token. Keep read-only TODO export on HTTP for LAN clients.
- Add an authenticated client-to-device LAN snapshot push operation. The client always initiates the connection; the device never calls back to the desktop. Keep the push bounded, revision-checked, and separate from task actions.
- Add an MQTT notification adapter with per-device topic authorization, TLS, bounded reconnect/backoff, and QoS suitable for server update hints. Notifications carry only a revision (and optional view/date), never TODO task actions. The adapter invalidates the ETag and triggers the existing HTTPS pull without becoming the source of truth.

## Testing Decisions

- The primary test seam is the `TodoSyncClient`/network-runtime boundary. Use a deterministic fake clock, fake Wi-Fi state, and fake HTTPS transport; assert externally observable sync results, request headers/query, cancellation, and retry timing rather than internal helper calls.
- Cover 200 responses, ETag storage, conditional requests, 304 no-op behavior, revision changes, malformed JSON, oversized bodies, invalid dates/times/statuses, parent cycles, item limits, and server status-to-firmware mapping.
- Cover authentication rejection, rate limiting, server errors, TLS/transport failures, Wi-Fi disconnect during a request, cancellation during backoff, bounded retries, and recovery after reconnection.
- Add application-level tests proving equal `TodoModel` values do not schedule a display update, changed values dispatch `TodosSynced`, selection/page indices remain valid, and a pending update is coalesced while a refresh is active.
- Add persistence tests for round-tripping the new configuration and TODO identity, redaction of secrets, migration of the prior numeric-ID format, size-limit rejection, and retention of the last good snapshot after a failed sync.
- Extend provisioning protocol tests for capability negotiation, typed TODO-sync patches, stale revisions, set/clear token validation, invalid URL/interval rejection, and backward-compatible omission of the patch.
- Add renderer tests for settings validation, provisioning payload construction, token redaction, and error presentation. Reuse the existing device provisioning and image/settings test conventions.
- Reuse the existing sync-server device TODO tests for scope enforcement, ETag/304, revision calculation, token expiry/revocation, and active-task projection. Add only contract tests needed to lock the firmware-facing field bounds and status names.
- A hardware smoke test should provision a test token, verify one 200 update and one 304 poll, disconnect/reconnect Wi-Fi, and confirm button input and front-light behavior while a display refresh is pending.

## Out of Scope

- MQTT task-action transport, broker administration UI, or using MQTT as the authoritative TODO data store.
- Device-originated TODO completion, reopening, editing, deletion, or conflict resolution. The firmware remains read-only.
- Changes to the desktop libp2p/Loro synchronization protocol or account tenancy model.
- Replacing local HTTP gallery/status/command endpoints.
- News, e-books, or unrelated NOTE4C pages and display features.
- Guaranteed sub-second freshness; polling cadence is intentionally bounded by power and e-paper constraints.
- Silent migration of arbitrary legacy firmware blobs that fail checksum/schema validation; those follow the existing recovery path.

## Further Notes

- The server API's top-level revision is the cache validator; per-item revisions are retained for a possible future action-capable client but are not used for writes in this read-only design.
- `today` requests use the device-configured timezone and a locally computed date. Clock-unavailable states should fall back to the last successful snapshot and report the reason rather than requesting an invented date.
- The firmware must treat server IDs as opaque and must not derive authorization or account identity from their contents.
- MQTT is a notification accelerator, not a second TODO database. The authoritative payload and validation rules remain HTTPS-based. Measure radio duty cycle and memory before enabling a long-lived subscription on battery-powered devices; reconnect and periodic pull must remain bounded.
