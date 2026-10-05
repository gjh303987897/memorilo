Type: research
Status: resolved
Blocked by: 02

## Question

How can the renderer resolve Memorilo-managed and external image resources into portable HTML data URLs without leaking local paths or silently dropping assets? Determine protocol constraints, size limits, failure reporting, and whether linked Reader resources need a textual/source fallback.

## Answer

HTML/PDF export uses one asynchronous resource resolver at the main-process boundary and passes only portable results to the shared static projection. The resolver recognizes managed images through `parseAssetFileName`: only canonical `memorilo://asset/<uuid-v4>.<ext>` URLs (single path segment, no credentials, port, query, or hash) are accepted. It reads the asset through a controlled adapter, derives MIME from the validated extension/metadata, enforces the existing 50 MiB byte limit, and returns a `data:<mime>;base64,...` URL. Renderer code never receives `assetDirectory` paths, and exported files never retain `memorilo:` URLs, IPC endpoints, application routes, or scripts. The adapter must surface 400/404/415, missing-directory, size, or MIME/signature failures as structured diagnostics.

External images are limited to HTTP(S), with redirect protocol checks, image MIME validation, and the same 50 MiB streaming cap. Export must not call the existing import operation because that persists a new managed asset. Instead, a one-shot controlled download may inline the bytes; if it fails, HTML keeps an escaped external URL only as an explicitly warned fallback, while PDF uses a visible alt/placeholder and warning so printing remains offline. No resource failure may become a blank image.

Reader text sources always export as a static quote plus location. Reader region sources use the same resolver for `imageSrc`; on failure they retain location and a visible “region image unavailable” placeholder/diagnostic. Linked references are exported without `/reader` navigation or session dependencies; annotation/book identifiers may remain non-visible diagnostic metadata. Each degradation records `path`, `kind`, `reason`, and `fallback`.

Research basis: [Note export asset inlining](../../../docs/research/note-export-assets.md).
