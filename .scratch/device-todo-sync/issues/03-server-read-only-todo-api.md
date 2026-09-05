# 03: Provide the server read-only TODO snapshot API

**What to build:** An authenticated server endpoint that returns the bounded TODO projection used by NOTE4C and supports conditional retrieval without exposing task mutation operations.

**Blocked by:** 01

**Status:** completed

- [x] Support `today` and `all` views, device-local date input, stable top-level revision, and active-task projection.
- [x] Support ETag validation and `304 Not Modified` with bounded response size and item count.
- [x] Enforce the device read scope and never expose completion, edit, delete, reorder, or action endpoints for this client.
- [x] Cover token expiry/revocation and projection contract tests.
