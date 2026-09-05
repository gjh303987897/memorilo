import type {
  DesktopDeviceGalleryStatus,
  DesktopDeviceGalleryTarget,
  DesktopDeviceGalleryUpload,
  DesktopDeviceStatus,
  DesktopDeviceTodoPush,
  DesktopDeviceTodoState,
  DesktopDeviceTodoTargetState,
  DesktopProvisioningDevice,
  DesktopProvisioningPairingRequest,
  DesktopProvisioningPairingResponse,
} from '@memorilo/desktop-api'
import type {
  ApplyConfigEnvelope,
  ApplyStatusEnvelope,
  DeviceConfigPatch,
  DeviceInfoEnvelope,
  PublicConfigEnvelope,
} from '@memorilo/device-provisioning'
import {
  decodeFrameSequence,
  encodeFrames,
  parseApplyStatusEnvelope,
  parseDeviceInfoEnvelope,
  parsePublicConfigEnvelope,
  PROTOCOL_VERSION,
  PROVISIONING_UUIDS,
  reassembleFrames,
} from '@memorilo/device-provisioning'
import { Data, Effect } from 'effect'

const characteristicChunkBytes = 180
const applyTimeoutMilliseconds = 15_000

// The Effect factory returns the base class; it is intentionally invoked without `new` here.
// eslint-disable-next-line unicorn/throw-new-error
export class DeviceProvisioningError extends Data.TaggedError('DeviceProvisioningError')<{
  readonly cause?: unknown
  readonly code: 'apply-rejected' | 'bluetooth-unavailable' | 'connection-failed' | 'local-management' | 'protocol-error' | 'secure-storage' | 'timeout'
}> {}

export interface ProvisionedDevice {
  readonly config: PublicConfigEnvelope
  readonly info: DeviceInfoEnvelope
  readonly name: string
}

export interface BluetoothCharacteristicAdapter {
  addEventListener: (type: 'characteristicvaluechanged', listener: (event: Event) => void) => void
  readValue: () => Promise<DataView>
  removeEventListener: (type: 'characteristicvaluechanged', listener: (event: Event) => void) => void
  startNotifications: () => Promise<BluetoothCharacteristicAdapter>
  value: DataView | null
  writeValueWithResponse: (value: BufferSource) => Promise<void>
}

export interface BluetoothServiceAdapter {
  getCharacteristic: (uuid: string) => Promise<BluetoothCharacteristicAdapter>
}

export interface BluetoothServerAdapter {
  connected: boolean
  disconnect: () => void
  getPrimaryService: (uuid: string) => Promise<BluetoothServiceAdapter>
}

export interface BluetoothDeviceAdapter {
  forget?: () => Promise<void>
  gatt?: {
    connect: () => Promise<BluetoothServerAdapter>
  }
  name?: string
}

export interface BluetoothAdapter {
  requestDevice: (options: { filters: Array<{ services: string[] }> }) => Promise<BluetoothDeviceAdapter>
}

interface PairingBridge {
  cancelSelection: () => Promise<void>
  clearLocalManagementToken: (deviceId: string) => Promise<void>
  deleteGalleryAsset: (target: DesktopDeviceGalleryTarget, id: number) => Promise<void>
  generateLocalManagementToken: () => Promise<string>
  hasLocalManagementToken: (deviceId: string) => Promise<boolean>
  loadGallery: (target: DesktopDeviceGalleryTarget) => Promise<DesktopDeviceGalleryStatus>
  loadStatus: (target: DesktopDeviceGalleryTarget) => Promise<DesktopDeviceStatus>
  loadTodos: (target: DesktopDeviceGalleryTarget) => Promise<DesktopDeviceTodoState>
  loadTodoTarget: (deviceId: string) => Promise<DesktopDeviceTodoTargetState>
  pushTodos: (input: DesktopDeviceTodoPush) => Promise<void>
  refreshDevice: (target: DesktopDeviceGalleryTarget) => Promise<void>
  nextDevicePage: (target: DesktopDeviceGalleryTarget) => Promise<void>
  sleepDevice: (target: DesktopDeviceGalleryTarget) => Promise<void>
  reorderGallery: (target: DesktopDeviceGalleryTarget, order: readonly number[]) => Promise<void>
  respondToPairing: (response: DesktopProvisioningPairingResponse) => Promise<void>
  saveLocalManagementToken: (deviceId: string, token: string) => Promise<void>
  saveTodoTarget: (deviceId: string, address: string | null) => Promise<void>
  setGallerySlideshow: (target: DesktopDeviceGalleryTarget, intervalSeconds: number | null) => Promise<void>
  selectDevice: (deviceId: string) => Promise<void>
  subscribeDevices: (listener: (devices: readonly DesktopProvisioningDevice[]) => void) => () => void
  subscribePairing: (listener: (request: DesktopProvisioningPairingRequest) => void) => () => void
  uploadGalleryAsset: (input: DesktopDeviceGalleryUpload) => Promise<void>
}

export interface DeviceProvisioningClient {
  cancelSelection: () => Effect.Effect<void, DeviceProvisioningError>
  clearLocalManagementToken: (deviceId: string) => Effect.Effect<void, DeviceProvisioningError>
  connect: () => Effect.Effect<DeviceProvisioningSession, DeviceProvisioningError>
  generateLocalManagementToken: () => Effect.Effect<string, DeviceProvisioningError>
  hasLocalManagementToken: (deviceId: string) => Effect.Effect<boolean, DeviceProvisioningError>
  deleteGalleryAsset: (target: DesktopDeviceGalleryTarget, id: number) => Effect.Effect<void, DeviceProvisioningError>
  loadGallery: (target: DesktopDeviceGalleryTarget) => Effect.Effect<DesktopDeviceGalleryStatus, DeviceProvisioningError>
  loadStatus: (target: DesktopDeviceGalleryTarget) => Effect.Effect<DesktopDeviceStatus, DeviceProvisioningError>
  loadTodos: (target: DesktopDeviceGalleryTarget) => Effect.Effect<DesktopDeviceTodoState, DeviceProvisioningError>
  loadTodoTarget: (deviceId: string) => Effect.Effect<DesktopDeviceTodoTargetState, DeviceProvisioningError>
  pushTodos: (input: DesktopDeviceTodoPush) => Effect.Effect<void, DeviceProvisioningError>
  refreshDevice: (target: DesktopDeviceGalleryTarget) => Effect.Effect<void, DeviceProvisioningError>
  nextDevicePage: (target: DesktopDeviceGalleryTarget) => Effect.Effect<void, DeviceProvisioningError>
  sleepDevice: (target: DesktopDeviceGalleryTarget) => Effect.Effect<void, DeviceProvisioningError>
  reorderGallery: (target: DesktopDeviceGalleryTarget, order: readonly number[]) => Effect.Effect<void, DeviceProvisioningError>
  respondToPairing: (response: DesktopProvisioningPairingResponse) => Effect.Effect<void, DeviceProvisioningError>
  saveLocalManagementToken: (deviceId: string, token: string) => Effect.Effect<void, DeviceProvisioningError>
  saveTodoTarget: (deviceId: string, address: string | null) => Effect.Effect<void, DeviceProvisioningError>
  setGallerySlideshow: (target: DesktopDeviceGalleryTarget, intervalSeconds: number | null) => Effect.Effect<void, DeviceProvisioningError>
  selectDevice: (device: DesktopProvisioningDevice) => Effect.Effect<void, DeviceProvisioningError>
  subscribeDevices: (listener: (devices: readonly DesktopProvisioningDevice[]) => void) => () => void
  subscribePairing: (listener: (request: DesktopProvisioningPairingRequest) => void) => () => void
  uploadGalleryAsset: (input: DesktopDeviceGalleryUpload) => Effect.Effect<void, DeviceProvisioningError>
}

export interface DeviceProvisioningSession {
  readonly device: ProvisionedDevice
  apply: (patch: DeviceConfigPatch) => Effect.Effect<ApplyStatusEnvelope, DeviceProvisioningError>
  close: () => Effect.Effect<void>
  forget: () => Effect.Effect<void, DeviceProvisioningError>
}

export class DeviceProvisioningConnection {
  private currentDevice: ProvisionedDevice
  private readonly statusWaiters = new Map<string, {
    reject: (error: unknown) => void
    resolve: (status: ApplyStatusEnvelope) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(
    device: ProvisionedDevice,
    private readonly bluetoothDevice: BluetoothDeviceAdapter,
    private readonly server: BluetoothServerAdapter,
    private readonly applyCharacteristic: BluetoothCharacteristicAdapter,
    private readonly statusCharacteristic: BluetoothCharacteristicAdapter,
  ) {
    this.currentDevice = device
    this.statusCharacteristic.addEventListener('characteristicvaluechanged', this.handleStatus)
  }

  get device(): ProvisionedDevice {
    return this.currentDevice
  }

  apply(patch: DeviceConfigPatch): Effect.Effect<ApplyStatusEnvelope, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => cause instanceof DeviceProvisioningError
        ? cause
        : toProvisioningError('connection-failed', cause),
      try: async () => {
        const requestId = globalThis.crypto.randomUUID()
        const request: ApplyConfigEnvelope = {
          baseRevision: this.device.config.revision,
          config: patch,
          protocolVersion: PROTOCOL_VERSION,
          requestId,
          requiredCapabilities: ['config-v1'],
        }
        const status = this.waitForStatus(requestId)
        try {
          const json = new TextEncoder().encode(JSON.stringify(request))
          for (const frame of encodeFrames(randomRequestToken(), json, characteristicChunkBytes)) {
            const writeBuffer = new Uint8Array(frame.byteLength)
            writeBuffer.set(frame)
            await this.applyCharacteristic.writeValueWithResponse(writeBuffer)
          }
          const result = await status
          if (result.status !== 'accepted') {
            throw new DeviceProvisioningError({
              code: 'apply-rejected',
              cause: result.error,
            })
          }
          this.currentDevice = {
            ...this.currentDevice,
            config: applyConfigPatch(this.currentDevice.config, patch, result.revision),
          }
          return result
        }
        catch (error) {
          this.cancelStatusWaiter(requestId)
          throw error
        }
      },
    })
  }

  close(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.statusCharacteristic.removeEventListener('characteristicvaluechanged', this.handleStatus)
      for (const waiter of this.statusWaiters.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new DeviceProvisioningError({ code: 'connection-failed' }))
      }
      this.statusWaiters.clear()
      if (this.server.connected)
        this.server.disconnect()
    })
  }

  forget(): Effect.Effect<void, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => toProvisioningError('connection-failed', cause),
      try: async () => {
        await Effect.runPromise(this.close())
        await this.bluetoothDevice.forget?.()
      },
    })
  }

  private readonly handleStatus = (event: Event): void => {
    try {
      const characteristic = event.currentTarget as BluetoothCharacteristicAdapter | null
      const value = characteristic?.value
      if (!value)
        return
      const status = parseApplyStatusEnvelope(decodeEnvelope(viewBytes(value)))
      const waiter = this.statusWaiters.get(status.requestId)
      if (!waiter)
        return
      clearTimeout(waiter.timer)
      this.statusWaiters.delete(status.requestId)
      waiter.resolve(status)
    }
    catch (error) {
      for (const waiter of this.statusWaiters.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(toProvisioningError('protocol-error', error))
      }
      this.statusWaiters.clear()
    }
  }

  private waitForStatus(requestId: string): Promise<ApplyStatusEnvelope> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.statusWaiters.delete(requestId)
        reject(new DeviceProvisioningError({ code: 'timeout' }))
      }, applyTimeoutMilliseconds)
      this.statusWaiters.set(requestId, { reject, resolve, timer })
    })
  }

  private cancelStatusWaiter(requestId: string): void {
    const waiter = this.statusWaiters.get(requestId)
    if (!waiter)
      return
    clearTimeout(waiter.timer)
    this.statusWaiters.delete(requestId)
  }
}

export class DeviceProvisioningService {
  constructor(
    private readonly adapter: BluetoothAdapter,
    private readonly bridge: PairingBridge,
  ) {}

  connect(): Effect.Effect<DeviceProvisioningConnection, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => cause instanceof DeviceProvisioningError
        ? cause
        : toProvisioningError('connection-failed', cause),
      try: async () => {
        const bluetoothDevice = await this.adapter.requestDevice({
          filters: [{ services: [PROVISIONING_UUIDS.service] }],
        })
        if (!bluetoothDevice.gatt)
          throw new DeviceProvisioningError({ code: 'connection-failed' })
        let server: BluetoothServerAdapter | null = null
        try {
          server = await bluetoothDevice.gatt.connect()
          const service = await server.getPrimaryService(PROVISIONING_UUIDS.service)
          const [infoCharacteristic, configCharacteristic, applyCharacteristic, statusCharacteristic]
            = await Promise.all([
              service.getCharacteristic(PROVISIONING_UUIDS.deviceInfo),
              service.getCharacteristic(PROVISIONING_UUIDS.publicConfig),
              service.getCharacteristic(PROVISIONING_UUIDS.configApply),
              service.getCharacteristic(PROVISIONING_UUIDS.status),
            ])
          await statusCharacteristic.startNotifications()
          const [infoValue, configValue] = await Promise.all([
            infoCharacteristic.readValue(),
            configCharacteristic.readValue(),
          ])
          const info = parseDeviceInfoEnvelope(decodeEnvelope(viewBytes(infoValue)))
          const config = parsePublicConfigEnvelope(decodeEnvelope(viewBytes(configValue)))
          return new DeviceProvisioningConnection(
            { config, info, name: bluetoothDevice.name ?? config.deviceName },
            bluetoothDevice,
            server,
            applyCharacteristic,
            statusCharacteristic,
          )
        }
        catch (error) {
          if (server?.connected)
            server.disconnect()
          throw error
        }
      },
    })
  }

  selectDevice(device: DesktopProvisioningDevice): Effect.Effect<void, DeviceProvisioningError> {
    return this.bridgeEffect(() => this.bridge.selectDevice(device.deviceId))
  }

  cancelSelection(): Effect.Effect<void, DeviceProvisioningError> {
    return this.bridgeEffect(() => this.bridge.cancelSelection())
  }

  clearLocalManagementToken(deviceId: string): Effect.Effect<void, DeviceProvisioningError> {
    return this.credentialEffect(() => this.bridge.clearLocalManagementToken(deviceId))
  }

  generateLocalManagementToken(): Effect.Effect<string, DeviceProvisioningError> {
    return this.credentialEffect(() => this.bridge.generateLocalManagementToken())
  }

  hasLocalManagementToken(deviceId: string): Effect.Effect<boolean, DeviceProvisioningError> {
    return this.credentialEffect(() => this.bridge.hasLocalManagementToken(deviceId))
  }

  deleteGalleryAsset(target: DesktopDeviceGalleryTarget, id: number): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.deleteGalleryAsset(target, id))
  }

  loadGallery(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceGalleryStatus, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadGallery(target))
  }

  loadStatus(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceStatus, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadStatus(target))
  }

  loadTodos(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceTodoState, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadTodos(target))
  }

  loadTodoTarget(deviceId: string): Effect.Effect<DesktopDeviceTodoTargetState, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadTodoTarget(deviceId))
  }

  pushTodos(input: DesktopDeviceTodoPush): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.pushTodos(input))
  }

  refreshDevice(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.refreshDevice(target))
  }

  nextDevicePage(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.nextDevicePage(target))
  }

  sleepDevice(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.sleepDevice(target))
  }

  reorderGallery(target: DesktopDeviceGalleryTarget, order: readonly number[]): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.reorderGallery(target, order))
  }

  respondToPairing(response: DesktopProvisioningPairingResponse): Effect.Effect<void, DeviceProvisioningError> {
    return this.bridgeEffect(() => this.bridge.respondToPairing(response))
  }

  saveLocalManagementToken(deviceId: string, token: string): Effect.Effect<void, DeviceProvisioningError> {
    return this.credentialEffect(() => this.bridge.saveLocalManagementToken(deviceId, token))
  }

  saveTodoTarget(deviceId: string, address: string | null): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.saveTodoTarget(deviceId, address))
  }

  setGallerySlideshow(
    target: DesktopDeviceGalleryTarget,
    intervalSeconds: number | null,
  ): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.setGallerySlideshow(target, intervalSeconds))
  }

  uploadGalleryAsset(input: DesktopDeviceGalleryUpload): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.uploadGalleryAsset(input))
  }

  subscribeDevices(listener: (devices: readonly DesktopProvisioningDevice[]) => void): () => void {
    return this.bridge.subscribeDevices(listener)
  }

  subscribePairing(listener: (request: DesktopProvisioningPairingRequest) => void): () => void {
    return this.bridge.subscribePairing(listener)
  }

  private bridgeEffect(operation: () => Promise<void>): Effect.Effect<void, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => toProvisioningError('connection-failed', cause),
      try: operation,
    })
  }

  private credentialEffect<Value>(operation: () => Promise<Value>): Effect.Effect<Value, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => toProvisioningError('secure-storage', cause),
      try: operation,
    })
  }

  private managementEffect<Value>(operation: () => Promise<Value>): Effect.Effect<Value, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => toProvisioningError('local-management', cause),
      try: operation,
    })
  }
}

function applyConfigPatch(
  config: PublicConfigEnvelope,
  patch: DeviceConfigPatch,
  revision: number,
): PublicConfigEnvelope {
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

export function createDeviceProvisioningService(): DeviceProvisioningService {
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothAdapter }).bluetooth
  if (!bluetooth) {
    const unavailable: BluetoothAdapter = {
      requestDevice: async () => {
        throw new DeviceProvisioningError({ code: 'bluetooth-unavailable' })
      },
    }
    return new DeviceProvisioningService(unavailable, window.desktop.deviceProvisioning)
  }
  return new DeviceProvisioningService(bluetooth, window.desktop.deviceProvisioning)
}

function decodeEnvelope(bytes: Uint8Array): Uint8Array {
  return reassembleFrames(decodeFrameSequence(bytes))
}

function viewBytes(value: DataView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function randomRequestToken(): number {
  const bytes = new Uint32Array(1)
  globalThis.crypto.getRandomValues(bytes)
  return bytes[0] ?? 0
}

function toProvisioningError(
  code: DeviceProvisioningError['code'],
  cause: unknown,
): DeviceProvisioningError {
  return new DeviceProvisioningError({ cause, code })
}
