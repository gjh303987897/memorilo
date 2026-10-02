import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { z } from 'zod'

const enabledModesSchema = z.preprocess(
  value => typeof value === 'string'
    ? value.split(',').map(mode => mode.trim()).filter(Boolean)
    : value,
  z.array(z.enum(['relay', 'authoritative'])).min(1)
    .refine(modes => new Set(modes).size === modes.length, 'Enabled sync modes must be unique'),
).default(['relay', 'authoritative'])

const stringBooleanSchema = z.union([z.boolean(), z.stringbool()])

const serverConfigSchema = z.object({
  dataDir: z.string().min(1).default('./data/sync-server'),
  deviceCredentialTtlMs: z.coerce.number().int().min(60 * 60 * 1000).max(365 * 24 * 60 * 60 * 1000).default(90 * 24 * 60 * 60 * 1000),
  enabledModes: enabledModesSchema,
  host: z.string().min(1).default('127.0.0.1'),
  maxApiRequestsPerMinute: z.coerce.number().int().min(1).max(100_000).default(600),
  maxAuthAttemptsPerMinute: z.coerce.number().int().min(1).max(10_000).default(10),
  maintenanceMode: z.enum(['off', 'read-only']).default('off'),
  port: z.coerce.number().int().min(0).max(65535).default(6000),
  metadataDatabase: z.enum(['sqlite', 'postgres']).default('sqlite'),
  postgresUrl: z.string().min(1).optional(),
  objectStore: z.enum(['filesystem', 's3']).default('filesystem'),
  filesystemRoot: z.string().min(1).optional(),
  s3AccessKeyId: z.string().min(1).optional(),
  s3Bucket: z.string().min(1).optional(),
  s3Endpoint: z.url().optional(),
  s3ForcePathStyle: stringBooleanSchema.default(false),
  s3Region: z.string().min(1).default('us-east-1'),
  s3SecretAccessKey: z.string().min(1).optional(),
  registration: z.enum(['disabled', 'invite-only', 'public']).default('disabled'),
  sessionIdleTimeoutMs: z.coerce.number().int().min(1_000).max(10 * 60 * 1000).default(30_000),
  sessionTotalTimeoutMs: z.coerce.number().int().min(1_000).max(60 * 60 * 1000).default(120_000),
  metricsToken: z.string().min(32).optional(),
  maxSyncSessionsPerAccount: z.coerce.number().int().min(1).max(1024).default(8),
  maxObjectTransfersPerAccount: z.coerce.number().int().min(1).max(1024).default(4),
  mqttTodoBrokerUrl: z.url().refine(value => value.startsWith('mqtts://'), 'TODO MQTT broker must use mqtts://').optional(),
  mqttTodoPassword: z.string().min(1).optional(),
  mqttTodoTopicPrefix: z.string().min(1).max(128).default('memorilo/todos'),
  mqttTodoUsername: z.string().min(1).optional(),
  orphanGraceMs: z.coerce.number().int().min(120_000).default(15 * 60 * 1000),
  orphanIntervalMs: z.coerce.number().int().min(10_000).default(60_000),
  trustProxy: stringBooleanSchema.default(false),
}).strict()

export type SyncServerConfig = z.infer<typeof serverConfigSchema>

function environmentOverrides(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries = [
    ['dataDir', env.MEMORILO_SYNC_SERVER_DATA_DIR],
    ['deviceCredentialTtlMs', env.MEMORILO_SYNC_SERVER_DEVICE_CREDENTIAL_TTL_MS],
    ['enabledModes', env.MEMORILO_SYNC_SERVER_ENABLED_MODES],
    ['host', env.MEMORILO_SYNC_SERVER_HOST],
    ['maxApiRequestsPerMinute', env.MEMORILO_SYNC_SERVER_MAX_API_REQUESTS_PER_MINUTE],
    ['maxAuthAttemptsPerMinute', env.MEMORILO_SYNC_SERVER_MAX_AUTH_ATTEMPTS_PER_MINUTE],
    ['maintenanceMode', env.MEMORILO_SYNC_SERVER_MAINTENANCE_MODE],
    ['port', env.MEMORILO_SYNC_SERVER_PORT],
    ['metadataDatabase', env.MEMORILO_SYNC_SERVER_METADATA_DATABASE],
    ['postgresUrl', env.MEMORILO_SYNC_SERVER_POSTGRES_URL],
    ['objectStore', env.MEMORILO_SYNC_SERVER_OBJECT_STORE],
    ['filesystemRoot', env.MEMORILO_SYNC_SERVER_FILESYSTEM_ROOT],
    ['s3AccessKeyId', env.MEMORILO_SYNC_SERVER_S3_ACCESS_KEY_ID],
    ['s3Bucket', env.MEMORILO_SYNC_SERVER_S3_BUCKET],
    ['s3Endpoint', env.MEMORILO_SYNC_SERVER_S3_ENDPOINT],
    ['s3ForcePathStyle', env.MEMORILO_SYNC_SERVER_S3_FORCE_PATH_STYLE],
    ['s3Region', env.MEMORILO_SYNC_SERVER_S3_REGION],
    ['s3SecretAccessKey', env.MEMORILO_SYNC_SERVER_S3_SECRET_ACCESS_KEY],
    ['registration', env.MEMORILO_SYNC_SERVER_REGISTRATION],
    ['sessionIdleTimeoutMs', env.MEMORILO_SYNC_SERVER_SESSION_IDLE_TIMEOUT_MS],
    ['sessionTotalTimeoutMs', env.MEMORILO_SYNC_SERVER_SESSION_TOTAL_TIMEOUT_MS],
    ['metricsToken', env.MEMORILO_SYNC_SERVER_METRICS_TOKEN],
    ['maxSyncSessionsPerAccount', env.MEMORILO_SYNC_SERVER_MAX_SYNC_SESSIONS_PER_ACCOUNT],
    ['maxObjectTransfersPerAccount', env.MEMORILO_SYNC_SERVER_MAX_OBJECT_TRANSFERS_PER_ACCOUNT],
    ['mqttTodoBrokerUrl', env.MEMORILO_SYNC_SERVER_MQTT_TODO_BROKER_URL],
    ['mqttTodoPassword', env.MEMORILO_SYNC_SERVER_MQTT_TODO_PASSWORD],
    ['mqttTodoTopicPrefix', env.MEMORILO_SYNC_SERVER_MQTT_TODO_TOPIC_PREFIX],
    ['mqttTodoUsername', env.MEMORILO_SYNC_SERVER_MQTT_TODO_USERNAME],
    ['orphanGraceMs', env.MEMORILO_SYNC_SERVER_ORPHAN_GRACE_MS],
    ['orphanIntervalMs', env.MEMORILO_SYNC_SERVER_ORPHAN_INTERVAL_MS],
    ['trustProxy', env.MEMORILO_SYNC_SERVER_TRUST_PROXY],
  ] as const
  const overrides: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (value !== undefined)
      overrides[key] = value
  }
  return overrides
}

export function parseSyncServerConfig(env: NodeJS.ProcessEnv = process.env, fileConfig: unknown = {}): SyncServerConfig {
  if (typeof fileConfig !== 'object' || fileConfig === null || Array.isArray(fileConfig))
    throw new TypeError('Sync server configuration file must contain a JSON object')
  const config = serverConfigSchema.parse({
    ...fileConfig,
    ...environmentOverrides(env),
  })
  if (config.metadataDatabase === 'postgres' && config.postgresUrl === undefined)
    throw new Error('PostgreSQL metadata provider requires MEMORILO_SYNC_SERVER_POSTGRES_URL')
  if (config.objectStore === 's3' && config.s3Bucket === undefined)
    throw new Error('S3 object provider requires MEMORILO_SYNC_SERVER_S3_BUCKET')
  if ((config.s3AccessKeyId === undefined) !== (config.s3SecretAccessKey === undefined))
    throw new Error('S3 access key id and secret access key must be configured together')
  if (config.mqttTodoBrokerUrl === undefined && (config.mqttTodoUsername !== undefined || config.mqttTodoPassword !== undefined))
    throw new Error('TODO MQTT credentials require a broker URL')
  if ((config.mqttTodoUsername === undefined) !== (config.mqttTodoPassword === undefined))
    throw new Error('TODO MQTT username and password must be configured together')
  if (config.sessionTotalTimeoutMs < config.sessionIdleTimeoutMs)
    throw new Error('Sync session total timeout must not be shorter than its idle timeout')
  return config
}

export async function loadSyncServerConfig(env: NodeJS.ProcessEnv = process.env): Promise<SyncServerConfig> {
  const path = env.MEMORILO_SYNC_SERVER_CONFIG_FILE
  if (path === undefined)
    return parseSyncServerConfig(env)
  try {
    return parseSyncServerConfig(env, JSON.parse(await readFile(path, 'utf8')) as unknown)
  }
  catch (error) {
    throw new Error(`Failed to load sync server configuration from ${path}`, { cause: error })
  }
}
