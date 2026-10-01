import type { DesktopDeviceTodoSnapshot } from '@memorilo/desktop-api'
import type {
  ApplyConfigEnvelope,
  DeviceConfigPatch,
  GalleryResponse,
  SerialProvisioningResponse,
} from '@memorilo/device-provisioning'
import type { GalleryUploadProgressListener } from './device-provisioning-service'
import {
  decodeFrameSequence,
  MAX_TODO_SNAPSHOT_BYTES,
  PROTOCOL_VERSION,
  ProvisioningProtocolError,
  reassembleFrames,
} from '@memorilo/device-provisioning'

import { Effect } from 'effect'
import { DeviceProvisioningError } from './device-provisioning-error'

export type BleConnectStage = 'characteristics' | 'connect' | 'decode' | 'notifications' | 'read' | 'selection' | 'service'
export type BleConnectOutcome = 'failure' | 'start' | 'success'

const bleConnectDiagnosticStorageKey = 'memorilo:ble-diagnostic:connect'

export function applyConfigPatch(
  config: import('@memorilo/device-provisioning').PublicConfigEnvelope,
  patch: DeviceConfigPatch,
  revision: number,
): import('@memorilo/device-provisioning').PublicConfigEnvelope {
  return {
    ...config,
    ...(patch.deviceName === undefined ? {} : { deviceName: patch.deviceName }),
    ...(patch.idleSleepSeconds === undefined ? {} : { idleSleepSeconds: patch.idleSleepSeconds }),
    ...(patch.selectionPolicy === undefined ? {} : { selectionPolicy: patch.selectionPolicy }),
    ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
    ...(patch.weather === undefined ? {} : { weather: patch.weather }),
    ...(patch.almanac === undefined ? {} : { almanac: patch.almanac }),
    ...(patch.todoSync?.enabled === undefined ? {} : { todoSyncEnabled: patch.todoSync.enabled }),
    ...(patch.todoSync?.httpsBaseUrl === undefined ? {} : { todoSyncUrl: patch.todoSync.httpsBaseUrl }),
    ...(patch.todoSync?.clearDeviceToken !== true && patch.todoSync?.deviceToken === undefined
      ? {}
      : { todoSyncTokenIsSet: patch.todoSync?.clearDeviceToken !== true }),
    ...(patch.todoSync?.pollIntervalSeconds === undefined ? {} : { todoSyncPollIntervalSeconds: patch.todoSync.pollIntervalSeconds }),
    ...(patch.todoSync?.view === undefined ? {} : { todoSyncView: patch.todoSync.view }),
    ...(patch.todoSync?.mqttBrokerUrl === undefined ? {} : { todoSyncMqttBrokerUrl: patch.todoSync.mqttBrokerUrl }),
    ...(patch.todoSync?.mqttTopic === undefined ? {} : { todoSyncMqttTopic: patch.todoSync.mqttTopic }),
    ...(patch.todoSync?.mqttUsername === undefined ? {} : { todoSyncMqttUsername: patch.todoSync.mqttUsername }),
    ...(patch.todoSync?.clearMqttPassword !== true && patch.todoSync?.mqttPassword === undefined
      ? {}
      : { todoSyncMqttPasswordIsSet: patch.todoSync?.clearMqttPassword !== true }),
    ...(patch.wifi?.ssid === undefined ? {} : { wifiSsid: patch.wifi.ssid }),
    ...(patch.wifi?.password === undefined && patch.wifi?.clearPassword !== true
      ? {}
      : { wifiPasswordIsSet: patch.wifi?.clearPassword !== true }),
    ...(patch.localManagement?.token === undefined && patch.localManagement?.clearToken !== true
      ? {}
      : { localManagementTokenIsSet: patch.localManagement?.clearToken !== true }),
    revision,
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function isGalleryResponse(value: SerialProvisioningResponse): value is GalleryResponse {
  return typeof value === 'object'
    && value !== null
    && typeof (value as GalleryResponse).operation === 'string'
    && (value as GalleryResponse).operation.startsWith('gallery.')
}

export function createApplyRequest(
  baseRevision: number,
  config: DeviceConfigPatch,
  requestId: string,
): ApplyConfigEnvelope {
  return {
    baseRevision,
    config,
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    requiredCapabilities: ['config-v1'],
  }
}

export function decodeEnvelope<Value>(
  value: DataView,
  characteristic: 'device-info' | 'public-config' | 'status',
  parse: (json: Uint8Array) => Value,
): Value {
  const diagnostic: {
    characteristic: typeof characteristic
    stage: 'frames' | 'reassembly' | 'envelope' | 'complete'
    bytes: number
    frames?: number
    expectedFrames?: number
    jsonBytes?: number
    error?: string
  } = { characteristic, stage: 'frames', bytes: value.byteLength }
  try {
    const frames = decodeFrameSequence(viewBytes(value))
    diagnostic.frames = frames.length
    diagnostic.expectedFrames = frames[0]?.count
    diagnostic.stage = 'reassembly'
    const json = reassembleFrames(frames)
    diagnostic.jsonBytes = json.byteLength
    diagnostic.stage = 'envelope'
    const result = parse(json)
    diagnostic.stage = 'complete'
    return result
  }
  catch (error) {
    diagnostic.error = error instanceof ProvisioningProtocolError ? error.code : 'unexpected-error'
    throw error
  }
  finally {
    if (import.meta.env.DEV) {
      const summary = JSON.stringify(diagnostic)
      console.warn('[DEBUG-ble-response] %s', summary)
      try {
        globalThis.sessionStorage?.setItem(`memorilo:ble-diagnostic:${characteristic}`, summary)
      }
      catch {
        // Diagnostics must not replace the original protocol outcome.
      }
    }
  }
}

export function concatDataViews(...values: DataView[]): DataView {
  const bytes = new Uint8Array(values.reduce((length, value) => length + value.byteLength, 0))
  let offset = 0
  for (const value of values) {
    bytes.set(viewBytes(value), offset)
    offset += value.byteLength
  }
  return new DataView(bytes.buffer)
}

export function recordBleConnectDiagnostic(
  stage: BleConnectStage,
  attempt: number,
  startedAt: number,
  outcome: BleConnectOutcome,
  cause?: unknown,
): void {
  if (!import.meta.env.DEV)
    return
  const diagnostic = {
    attempt,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    outcome,
    stage,
    ...(cause instanceof DOMException
      ? { domException: { message: cause.message.slice(0, 240), name: cause.name.slice(0, 80) } }
      : {}),
  }
  console.warn('[DEBUG-ble-connect] %s', JSON.stringify(diagnostic))
  try {
    const stored = globalThis.sessionStorage?.getItem(bleConnectDiagnosticStorageKey)
    const parsed: unknown = stored === null || stored === undefined ? [] : JSON.parse(stored)
    const timeline = Array.isArray(parsed) ? parsed.slice(-63) : []
    globalThis.sessionStorage?.setItem(bleConnectDiagnosticStorageKey, JSON.stringify([...timeline, diagnostic]))
  }
  catch {
    // Diagnostics must not replace the original connection outcome.
  }
}

export function resetBleConnectDiagnostics(): void {
  if (!import.meta.env.DEV)
    return
  try {
    globalThis.sessionStorage?.removeItem(bleConnectDiagnosticStorageKey)
  }
  catch {
    // Diagnostics must not replace the original connection outcome.
  }
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

export function viewBytes(value: DataView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

export function randomRequestToken(): number {
  const bytes = new Uint32Array(1)
  globalThis.crypto.getRandomValues(bytes)
  return bytes[0] ?? 0
}

export function notifyGalleryUploadProgress(
  listener: GalleryUploadProgressListener | undefined,
  sentBytes: number,
  totalBytes: number,
): Effect.Effect<void> {
  return listener
    ? Effect.sync(() => listener({ sentBytes, totalBytes }))
    : Effect.void
}

export function toProvisioningError(
  code: DeviceProvisioningError['code'],
  cause: unknown,
): DeviceProvisioningError {
  return new DeviceProvisioningError({ cause, code })
}

export function todoSnapshotFitsProtocol(snapshot: DesktopDeviceTodoSnapshot): boolean {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= MAX_TODO_SNAPSHOT_BYTES
}
