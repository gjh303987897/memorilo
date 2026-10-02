# Memorilo Sync Server container

<!-- ghcr-description -->
Self-hosted Memorilo Sync Server. The image listens on port 6000 and stores persistent data in /var/lib/memorilo-sync. Configure it with MEMORILO_SYNC_SERVER_* environment variables or MEMORILO_SYNC_SERVER_CONFIG_FILE. Full environment reference: https://github.com/memorilo/memorilo/blob/main/apps/sync-server/README.md#configuration
<!-- /ghcr-description -->

The container image is published at `ghcr.io/memorilo/memorilo-sync-server`. Stable releases also receive the `latest` tag; prereleases use their explicit SemVer tags.

```sh
docker run --detach \
  --name memorilo-sync-server \
  --publish 6000:6000 \
  --volume memorilo-sync-data:/var/lib/memorilo-sync \
  ghcr.io/memorilo/memorilo-sync-server:latest
```

The image runs as a non-root user, exposes the HTTP/WebSocket server on port `6000`, and persists SQLite metadata, the server identity, and filesystem objects under `/var/lib/memorilo-sync`.

## Configuration

Configuration is read once during process startup. Stop the process before changing providers or enabled modes. The image defaults bind `0.0.0.0:6000`, use SQLite plus filesystem objects, allow Relay and Authoritative modes, and disable registration.

Set `MEMORILO_SYNC_SERVER_CONFIG_FILE` to a JSON file whose keys use the camel-case names in `SyncServerConfig`. Unknown keys and invalid values reject startup. Explicit `MEMORILO_SYNC_SERVER_*` variables override matching values from the file. For example:

```json
{
  "dataDir": "/var/lib/memorilo-sync",
  "enabledModes": ["relay", "authoritative"],
  "host": "0.0.0.0",
  "maintenanceMode": "off",
  "metadataDatabase": "sqlite",
  "objectStore": "filesystem",
  "port": 6000,
  "registration": "disabled",
  "sessionIdleTimeoutMs": 30000,
  "sessionTotalTimeoutMs": 120000,
  "trustProxy": false
}
```

| Variable | Meaning |
| --- | --- |
| `MEMORILO_SYNC_SERVER_CONFIG_FILE` | Optional JSON configuration file. Its camel-case keys are merged first; environment variables override matching keys. |
| `MEMORILO_SYNC_SERVER_DOMAIN` | Caddy deployment variable, not read by the Sync Server process. Sets the public hostname in `deploy/Caddyfile`. |
| `MEMORILO_SYNC_SERVER_DATA_DIR` | Root directory for the SQLite database, server peer identity, and default filesystem objects. The image defaults to `/var/lib/memorilo-sync`; the application default outside the image is `./data/sync-server`. |
| `MEMORILO_SYNC_SERVER_HOST` | Application listen address. The image defaults to `0.0.0.0`; the application default outside the image is `127.0.0.1`. |
| `MEMORILO_SYNC_SERVER_PORT` | Application HTTP/WebSocket front door. Default `6000`. |
| `MEMORILO_SYNC_SERVER_ENABLED_MODES` | Comma-separated `relay`, `authoritative`, or both. Default `relay,authoritative`; this is the upper bound for every account policy. |
| `MEMORILO_SYNC_SERVER_DEVICE_CREDENTIAL_TTL_MS` | Lifetime for newly issued scoped device credentials. Default 90 days; minimum one hour. |
| `MEMORILO_SYNC_SERVER_MAINTENANCE_MODE` | `off` or `read-only`. Default `off`; read-only rejects sync payload writes and management mutations. |
| `MEMORILO_SYNC_SERVER_REGISTRATION` | `disabled`, `invite-only`, or `public`. Default `disabled`. An empty installation permits one initial account from any IP before this policy applies. |
| `MEMORILO_SYNC_SERVER_METADATA_DATABASE` | Metadata provider: `sqlite` or `postgres`. Default `sqlite`. |
| `MEMORILO_SYNC_SERVER_POSTGRES_URL` | PostgreSQL connection URL; required when `MEMORILO_SYNC_SERVER_METADATA_DATABASE=postgres`. |
| `MEMORILO_SYNC_SERVER_OBJECT_STORE` | Object provider: `filesystem` or `s3`. Default `filesystem`; this is independent of the metadata provider. |
| `MEMORILO_SYNC_SERVER_FILESYSTEM_ROOT` | Filesystem object root. Defaults to `<MEMORILO_SYNC_SERVER_DATA_DIR>/objects` when omitted. |
| `MEMORILO_SYNC_SERVER_S3_ACCESS_KEY_ID` | Optional S3 access key. Must be provided together with `MEMORILO_SYNC_SERVER_S3_SECRET_ACCESS_KEY`; SDK credentials are used when both are omitted. |
| `MEMORILO_SYNC_SERVER_S3_SECRET_ACCESS_KEY` | Optional S3 secret key. Must be provided together with `MEMORILO_SYNC_SERVER_S3_ACCESS_KEY_ID`. |
| `MEMORILO_SYNC_SERVER_S3_BUCKET` | S3 bucket; required when `MEMORILO_SYNC_SERVER_OBJECT_STORE=s3`. |
| `MEMORILO_SYNC_SERVER_S3_ENDPOINT` | Optional S3-compatible endpoint URL, such as an R2, MinIO, or other compatible service endpoint. |
| `MEMORILO_SYNC_SERVER_S3_REGION` | S3 signing region. Default `us-east-1`. |
| `MEMORILO_SYNC_SERVER_S3_FORCE_PATH_STYLE` | Whether to use path-style S3 requests. Accepts boolean strings such as `true` and `false`; default `false`. |
| `MEMORILO_SYNC_SERVER_SESSION_IDLE_TIMEOUT_MS` | Maximum time without sync or object-stream activity. Default 30 seconds. |
| `MEMORILO_SYNC_SERVER_SESSION_TOTAL_TIMEOUT_MS` | Maximum lifetime of one sync or object stream. Default 2 minutes and never shorter than the idle timeout. |
| `MEMORILO_SYNC_SERVER_MAX_SYNC_SESSIONS_PER_ACCOUNT` | Maximum concurrent sync sessions per account. Default `8`. |
| `MEMORILO_SYNC_SERVER_MAX_OBJECT_TRANSFERS_PER_ACCOUNT` | Maximum concurrent object transfers per account. Default `4`. |
| `MEMORILO_SYNC_SERVER_ORPHAN_GRACE_MS` | Delay before an unreferenced object is eligible for cleanup. Default 15 minutes; minimum 2 minutes. |
| `MEMORILO_SYNC_SERVER_ORPHAN_INTERVAL_MS` | Interval between orphan reconciliation passes. Default 1 minute; minimum 10 seconds. |
| `MEMORILO_SYNC_SERVER_METRICS_TOKEN` | Optional token of at least 32 characters. `/metrics` does not exist when omitted. |
| `MEMORILO_SYNC_SERVER_TRUST_PROXY` | Set to `true` only when every request reaches the app through a trusted proxy that replaces `X-Forwarded-For`. Default `false`. |
| `MEMORILO_SYNC_SERVER_MAX_AUTH_ATTEMPTS_PER_MINUTE` | Per-client setup, registration, and login attempt limit. Default `10`. |
| `MEMORILO_SYNC_SERVER_MAX_API_REQUESTS_PER_MINUTE` | Per-client management API limit. Default `600`. |

Secrets must come from the container runtime or service manager's secret environment or credential facility. Do not write them into the image, Caddyfile, or logs.

See [Sync Server operations](../../docs/sync-server-operations.md) for TLS proxying, account pairing, health checks, backup and restore, maintenance, and provider migration.
