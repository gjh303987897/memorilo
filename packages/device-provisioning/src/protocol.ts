export const PROTOCOL_VERSION = 1
export const CONFIG_SCHEMA_VERSION = 2
export const MAX_JSON_BYTES = 4096
export const MAX_CHUNKS = 32
export const MAX_CHUNK_PAYLOAD_BYTES = 384
export const FRAME_HEADER_BYTES = 18

export const PROVISIONING_UUIDS = {
  service: '7b7a1000-6c6f-4d65-8a8b-6d656d6f7269',
  deviceInfo: '7b7a1001-6c6f-4d65-8a8b-6d656d6f7269',
  publicConfig: '7b7a1002-6c6f-4d65-8a8b-6d656d6f7269',
  configApply: '7b7a1003-6c6f-4d65-8a8b-6d656d6f7269',
  status: '7b7a1004-6c6f-4d65-8a8b-6d656d6f7269',
} as const

const FRAME_MAGIC = [0x4D, 0x50] as const
const FRAME_VERSION = 1
const FLAG_START = 1
const FLAG_END = 2

export type SelectionPolicy = 'Remember' | 'FirstOpen'

export interface DeviceInfoEnvelope {
  protocolVersion: number
  configSchemaVersion: number
  firmwareVersion: string
  deviceId: string
  configRevision: number
  capabilities: string[]
}

export interface PublicConfigEnvelope {
  protocolVersion: number
  configSchemaVersion: number
  revision: number
  deviceName: string
  wifiSsid?: string
  wifiPasswordIsSet: boolean
  localManagementTokenIsSet: boolean
  timezone: string
  idleSleepSeconds: number
  selectionPolicy: SelectionPolicy
  weather?: WeatherConfig
  almanac?: AlmanacConfig
  todoSyncEnabled: boolean
  todoSyncUrl: string
  todoSyncTokenIsSet: boolean
  todoSyncPollIntervalSeconds: number
  todoSyncView: TodoView
  todoSyncMqttBrokerUrl?: string
  todoSyncMqttTopic?: string
  todoSyncMqttUsername?: string
  todoSyncMqttPasswordIsSet?: boolean
}

export type TodoView = 'today' | 'all'

export interface WeatherConfig {
  enabled: boolean
  locationName: string
  latitudeE6: number
  longitudeE6: number
}

export interface AlmanacConfig { note: string, source: string }

export interface DeviceConfigPatch {
  deviceName?: string
  wifi?: {
    ssid?: string
    password?: string
    clearPassword?: boolean
  }
  localManagement?: {
    token?: string
    clearToken?: boolean
  }
  timezone?: string
  idleSleepSeconds?: number
  selectionPolicy?: SelectionPolicy
  weather?: WeatherConfig
  almanac?: AlmanacConfig
  todoSync?: {
    enabled?: boolean
    httpsBaseUrl?: string
    deviceToken?: string
    clearDeviceToken?: boolean
    pollIntervalSeconds?: number
    view?: TodoView
    mqttBrokerUrl?: string
    mqttTopic?: string
    mqttUsername?: string
    mqttPassword?: string
    clearMqttPassword?: boolean
  }
  [optionalExtension: string]: unknown
}

export interface ApplyConfigEnvelope {
  protocolVersion: number
  requestId: string
  baseRevision: number
  requiredCapabilities: string[]
  config: DeviceConfigPatch
}

export type ApplyStatus = 'accepted' | 'rejected'

export type ProtocolErrorCode
  = | 'authentication-required'
    | 'configuration-mode-required'
    | 'unsupported-protocol'
    | 'unsupported-capability'
    | 'invalid-request'
    | 'stale-revision'
    | 'checksum-mismatch'
    | 'request-too-large'
    | 'timeout'
    | 'storage-failure'

export interface ApplyStatusEnvelope {
  protocolVersion: number
  requestId: string
  status: ApplyStatus
  revision: number
  error?: ProtocolErrorCode
}

export interface ChunkFrame {
  requestToken: number
  index: number
  count: number
  checksum: number
  payload: Uint8Array
}

export class ProvisioningProtocolError extends Error {
  constructor(
    readonly code:
      | 'checksum-mismatch'
      | 'duplicate-chunk'
      | 'inconsistent-request'
      | 'invalid-bounds'
      | 'invalid-header'
      | 'invalid-request'
      | 'missing-chunk'
      | 'request-too-large'
      | 'stale-revision'
      | 'unsupported-capability'
      | 'unsupported-protocol',
  ) {
    super(code)
    this.name = 'ProvisioningProtocolError'
  }
}

export function assertCurrentRevision(
  request: ApplyConfigEnvelope,
  currentRevision: number,
): void {
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0)
    throw new ProvisioningProtocolError('invalid-bounds')
  if (request.baseRevision !== currentRevision)
    throw new ProvisioningProtocolError('stale-revision')
}

export function parseApplyConfigEnvelope(json: Uint8Array): ApplyConfigEnvelope {
  if (json.byteLength > MAX_JSON_BYTES)
    throw new ProvisioningProtocolError('request-too-large')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(json))
  }
  catch {
    throw new ProvisioningProtocolError('invalid-request')
  }
  if (!isRecord(value)
    || value.protocolVersion !== PROTOCOL_VERSION
    || typeof value.requestId !== 'string'
    || value.requestId.length === 0
    || value.requestId.length > 64
    || !isAscii(value.requestId)
    || !Number.isSafeInteger(value.baseRevision)
    || !Array.isArray(value.requiredCapabilities)
    || !value.requiredCapabilities.every(capability => typeof capability === 'string')
    || !isRecord(value.config)) {
    throw new ProvisioningProtocolError(
      isRecord(value) && value.protocolVersion !== PROTOCOL_VERSION
        ? 'unsupported-protocol'
        : 'invalid-request',
    )
  }
  if (value.requiredCapabilities.some(capability => capability !== 'config-v1'))
    throw new ProvisioningProtocolError('unsupported-capability')
  return value as unknown as ApplyConfigEnvelope
}

export function encodeFrames(
  requestToken: number,
  json: Uint8Array,
  maximumPayload: number,
): Uint8Array[] {
  if (json.byteLength > MAX_JSON_BYTES)
    throw new ProvisioningProtocolError('request-too-large')
  if (!Number.isInteger(maximumPayload)
    || maximumPayload <= 0
    || maximumPayload > MAX_CHUNK_PAYLOAD_BYTES) {
    throw new ProvisioningProtocolError('invalid-bounds')
  }
  const count = Math.max(1, Math.ceil(json.byteLength / maximumPayload))
  if (count > MAX_CHUNKS)
    throw new ProvisioningProtocolError('invalid-bounds')
  const checksum = crc32(json)
  return Array.from({ length: count }, (_, index) => {
    const payload = json.slice(index * maximumPayload, (index + 1) * maximumPayload)
    const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength)
    const view = new DataView(frame.buffer)
    frame[0] = FRAME_MAGIC[0]
    frame[1] = FRAME_MAGIC[1]
    frame[2] = FRAME_VERSION
    frame[3] = (index === 0 ? FLAG_START : 0) | (index + 1 === count ? FLAG_END : 0)
    view.setUint32(4, requestToken, true)
    view.setUint16(8, index, true)
    view.setUint16(10, count, true)
    view.setUint16(12, payload.byteLength, true)
    view.setUint32(14, checksum, true)
    frame.set(payload, FRAME_HEADER_BYTES)
    return frame
  })
}

export function decodeFrame(bytes: Uint8Array): ChunkFrame {
  if (bytes.byteLength < FRAME_HEADER_BYTES
    || bytes[0] !== FRAME_MAGIC[0]
    || bytes[1] !== FRAME_MAGIC[1]
    || bytes[2] !== FRAME_VERSION) {
    throw new ProvisioningProtocolError('invalid-header')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const index = view.getUint16(8, true)
  const count = view.getUint16(10, true)
  const payloadLength = view.getUint16(12, true)
  if (count === 0
    || count > MAX_CHUNKS
    || index >= count
    || payloadLength > MAX_CHUNK_PAYLOAD_BYTES
    || bytes.byteLength !== FRAME_HEADER_BYTES + payloadLength) {
    throw new ProvisioningProtocolError('invalid-bounds')
  }
  const flags = bytes[3] ?? 0
  if ((index === 0) !== ((flags & FLAG_START) !== 0)
    || (index + 1 === count) !== ((flags & FLAG_END) !== 0)) {
    throw new ProvisioningProtocolError('invalid-header')
  }
  return {
    requestToken: view.getUint32(4, true),
    index,
    count,
    checksum: view.getUint32(14, true),
    payload: bytes.slice(FRAME_HEADER_BYTES),
  }
}

export function decodeFrameSequence(bytes: Uint8Array): ChunkFrame[] {
  const frames: ChunkFrame[] = []
  let offset = 0
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < FRAME_HEADER_BYTES)
      throw new ProvisioningProtocolError('invalid-header')
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset)
    const frameLength = FRAME_HEADER_BYTES + view.getUint16(12, true)
    if (offset + frameLength > bytes.byteLength)
      throw new ProvisioningProtocolError('invalid-bounds')
    frames.push(decodeFrame(bytes.slice(offset, offset + frameLength)))
    offset += frameLength
  }
  return frames
}

export function parseDeviceInfoEnvelope(json: Uint8Array): DeviceInfoEnvelope {
  const value = parseJsonRecord(json)
  if (value.protocolVersion !== PROTOCOL_VERSION
    || value.configSchemaVersion !== CONFIG_SCHEMA_VERSION
    || typeof value.firmwareVersion !== 'string'
    || typeof value.deviceId !== 'string'
    || !Number.isSafeInteger(value.configRevision)
    || !Array.isArray(value.capabilities)
    || !value.capabilities.every(capability => typeof capability === 'string')) {
    throw new ProvisioningProtocolError('invalid-request')
  }
  return value as unknown as DeviceInfoEnvelope
}

export function parsePublicConfigEnvelope(json: Uint8Array): PublicConfigEnvelope {
  const value = parseJsonRecord(json)
  if (value.protocolVersion !== PROTOCOL_VERSION
    || value.configSchemaVersion !== CONFIG_SCHEMA_VERSION
    || !Number.isSafeInteger(value.revision)
    || typeof value.deviceName !== 'string'
    || (value.wifiSsid !== undefined && typeof value.wifiSsid !== 'string')
    || typeof value.wifiPasswordIsSet !== 'boolean'
    || (value.localManagementTokenIsSet !== undefined && typeof value.localManagementTokenIsSet !== 'boolean')
    || typeof value.timezone !== 'string'
    || !Number.isSafeInteger(value.idleSleepSeconds)
    || (value.selectionPolicy !== 'Remember' && value.selectionPolicy !== 'FirstOpen')
    || (value.weather !== undefined && !isWeatherConfig(value.weather))
    || (value.almanac !== undefined && !isAlmanacConfig(value.almanac))) {
    throw new ProvisioningProtocolError('invalid-request')
  }
  if (typeof value.todoSyncEnabled !== 'boolean'
    || typeof value.todoSyncUrl !== 'string'
    || typeof value.todoSyncTokenIsSet !== 'boolean'
    || !Number.isSafeInteger(value.todoSyncPollIntervalSeconds)
    || (value.todoSyncView !== 'today' && value.todoSyncView !== 'all')
    || (value.todoSyncMqttBrokerUrl !== undefined && typeof value.todoSyncMqttBrokerUrl !== 'string')
    || (value.todoSyncMqttTopic !== undefined && typeof value.todoSyncMqttTopic !== 'string')
    || (value.todoSyncMqttUsername !== undefined && typeof value.todoSyncMqttUsername !== 'string')
    || (value.todoSyncMqttPasswordIsSet !== undefined && typeof value.todoSyncMqttPasswordIsSet !== 'boolean')) {
    throw new ProvisioningProtocolError('invalid-request')
  }
  return {
    ...value,
    localManagementTokenIsSet: value.localManagementTokenIsSet ?? false,
  } as unknown as PublicConfigEnvelope
}

function isWeatherConfig(value: unknown): value is WeatherConfig {
  return isRecord(value)
    && typeof value.enabled === 'boolean'
    && typeof value.locationName === 'string'
    && Number.isSafeInteger(value.latitudeE6)
    && Number.isSafeInteger(value.longitudeE6)
}

function isAlmanacConfig(value: unknown): value is AlmanacConfig {
  return isRecord(value) && typeof value.note === 'string' && typeof value.source === 'string'
}

export function parseApplyStatusEnvelope(json: Uint8Array): ApplyStatusEnvelope {
  const value = parseJsonRecord(json)
  if (value.protocolVersion !== PROTOCOL_VERSION
    || typeof value.requestId !== 'string'
    || (value.status !== 'accepted' && value.status !== 'rejected')
    || !Number.isSafeInteger(value.revision)
    || (value.error !== undefined && !isProtocolErrorCode(value.error))) {
    throw new ProvisioningProtocolError('invalid-request')
  }
  return value as unknown as ApplyStatusEnvelope
}

export function reassembleFrames(frames: readonly ChunkFrame[]): Uint8Array {
  const first = frames[0]
  if (!first || frames.length !== first.count)
    throw new ProvisioningProtocolError('missing-chunk')
  const ordered: Array<Uint8Array | undefined> = Array.from({ length: first.count })
  for (const frame of frames) {
    if (frame.requestToken !== first.requestToken
      || frame.count !== first.count
      || frame.checksum !== first.checksum) {
      throw new ProvisioningProtocolError('inconsistent-request')
    }
    if (ordered[frame.index])
      throw new ProvisioningProtocolError('duplicate-chunk')
    ordered[frame.index] = frame.payload
  }
  if (ordered.some(payload => !payload))
    throw new ProvisioningProtocolError('missing-chunk')
  const length = ordered.reduce((sum, payload) => sum + (payload?.byteLength ?? 0), 0)
  if (length > MAX_JSON_BYTES)
    throw new ProvisioningProtocolError('request-too-large')
  const json = new Uint8Array(length)
  let offset = 0
  for (const payload of ordered) {
    json.set(payload!, offset)
    offset += payload!.byteLength
  }
  if (crc32(json) !== first.checksum)
    throw new ProvisioningProtocolError('checksum-mismatch')
  return json
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFF_FFFF
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xEDB8_8320 & -(crc & 1))
  }
  return (~crc) >>> 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonRecord(json: Uint8Array): Record<string, unknown> {
  if (json.byteLength > MAX_JSON_BYTES)
    throw new ProvisioningProtocolError('request-too-large')
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(json))
    if (isRecord(value))
      return value
  }
  catch {
    // The stable protocol error is more useful to callers than JSON syntax details.
  }
  throw new ProvisioningProtocolError('invalid-request')
}

function isProtocolErrorCode(value: unknown): value is ProtocolErrorCode {
  return typeof value === 'string' && [
    'authentication-required',
    'configuration-mode-required',
    'unsupported-protocol',
    'unsupported-capability',
    'invalid-request',
    'stale-revision',
    'checksum-mismatch',
    'request-too-large',
    'timeout',
    'storage-failure',
  ].includes(value)
}

function isAscii(value: string): boolean {
  return Array.from(value).every(character => character.codePointAt(0)! <= 0x7F)
}
