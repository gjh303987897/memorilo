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
import { Data, Deferred, Effect } from 'effect'

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
  addEventListener: (type: 'gattserverdisconnected', listener: () => void) => void
  removeEventListener: (type: 'gattserverdisconnected', listener: () => void) => void
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
  readonly connected: boolean
  subscribeDisconnected: (listener: () => void) => () => void
  readonly device: ProvisionedDevice
  apply: (patch: DeviceConfigPatch) => Effect.Effect<ApplyStatusEnvelope, DeviceProvisioningError>
  close: () => Effect.Effect<void>
  forget: () => Effect.Effect<void, DeviceProvisioningError>
}

export class DeviceProvisioningConnection {
  private currentDevice: ProvisionedDevice
  private readonly statusWaiters = new Map<string, Deferred.Deferred<ApplyStatusEnvelope, DeviceProvisioningError>>()
  private readonly disconnected = Deferred.makeUnsafe<never, DeviceProvisioningError>()
  private readonly disconnectListeners = new Set<() => void>()
  private closed = false

  constructor(
    device: ProvisionedDevice,
    private readonly bluetoothDevice: BluetoothDeviceAdapter,
    private readonly server: BluetoothServerAdapter,
    private readonly applyCharacteristic: BluetoothCharacteristicAdapter,
    private readonly statusCharacteristic: BluetoothCharacteristicAdapter,
  ) {
    this.currentDevice = device
    this.statusCharacteristic.addEventListener('characteristicvaluechanged', this.handleStatus)
    this.bluetoothDevice.addEventListener('gattserverdisconnected', this.handleDisconnected)
  }

  get connected(): boolean {
    return !this.closed && this.server.connected
  }

  subscribeDisconnected(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    if (!this.connected)
      listener()
    return () => {
      this.disconnectListeners.delete(listener)
    }
  }

  get device(): ProvisionedDevice {
    return this.currentDevice
  }

  apply(patch: DeviceConfigPatch): Effect.Effect<ApplyStatusEnvelope, DeviceProvisioningError> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const requestId = globalThis.crypto.randomUUID()
        const status = Deferred.makeUnsafe<ApplyStatusEnvelope, DeviceProvisioningError>()
        this.statusWaiters.set(requestId, status)
        return { requestId, status }
      }),
      ({ requestId, status }) => Effect.gen({ self: this }, function* () {
        if (!this.connected)
          return yield* Effect.fail(new DeviceProvisioningError({ code: 'connection-failed' }))
        const request: ApplyConfigEnvelope = {
          baseRevision: this.device.config.revision,
          config: patch,
          protocolVersion: PROTOCOL_VERSION,
          requestId,
          requiredCapabilities: ['config-v1'],
        }
        const exchange = Effect.gen({ self: this }, function* () {
          const frames = yield* Effect.try({
            try: () => encodeFrames(randomRequestToken(), new TextEncoder().encode(JSON.stringify(request)), characteristicChunkBytes),
            catch: cause => toProvisioningError('protocol-error', cause),
          })
          for (const frame of frames) {
            yield* Effect.tryPromise({
              try: () => this.applyCharacteristic.writeValueWithResponse(new Uint8Array(frame)),
              catch: cause => toProvisioningError('connection-failed', cause),
            })
          }
          const result = yield* Deferred.await(status)
          if (result.status !== 'accepted') {
            return yield* Effect.fail(new DeviceProvisioningError({
              code: 'apply-rejected',
              cause: result.error,
            }))
          }
          this.currentDevice = {
            ...this.currentDevice,
            config: applyConfigPatch(this.currentDevice.config, patch, result.revision),
          }
          return result
        })
        return yield* exchange.pipe(
          Effect.raceFirst(Deferred.await(this.disconnected)),
          Effect.timeoutOrElse({
            duration: applyTimeoutMilliseconds,
            onTimeout: () => Effect.fail(new DeviceProvisioningError({ code: 'timeout' })),
          }),
        )
      }),
      ({ requestId }) => Effect.sync(() => { this.statusWaiters.delete(requestId) }),
    ).pipe(
      Effect.onError(() => this.close()),
      Effect.onInterrupt(() => this.close()),
    )
  }

  close(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.handleDisconnected()
      if (this.server.connected)
        this.server.disconnect()
    })
  }

  private readonly handleDisconnected = (): void => {
    if (this.closed)
      return
    this.closed = true
    this.statusCharacteristic.removeEventListener('characteristicvaluechanged', this.handleStatus)
    this.bluetoothDevice.removeEventListener('gattserverdisconnected', this.handleDisconnected)
    Deferred.doneUnsafe(this.disconnected, Effect.fail(new DeviceProvisioningError({ code: 'connection-failed' })))
    for (const listener of this.disconnectListeners)
      listener()
    this.disconnectListeners.clear()
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
      this.statusWaiters.delete(status.requestId)
      Deferred.doneUnsafe(waiter, Effect.succeed(status))
    }
    catch (error) {
      for (const waiter of this.statusWaiters.values()) {
        Deferred.doneUnsafe(waiter, Effect.fail(toProvisioningError('protocol-error', error)))
      }
      this.statusWaiters.clear()
    }
  }
}

export class DeviceProvisioningService {
  constructor(
    private readonly adapter: BluetoothAdapter,
    private readonly bridge: PairingBridge,
  ) {}

  connect(): Effect.Effect<DeviceProvisioningConnection, DeviceProvisioningError> {
    const request = <T>(run: (signal: AbortSignal) => Promise<T>) => Effect.tryPromise({
      try: run,
      catch: cause => toProvisioningError('connection-failed', cause),
    })
    return Effect.acquireUseRelease(
      Effect.sync(() => ({ server: null as BluetoothServerAdapter | null, transferred: false })),
      resource => Effect.gen({ self: this }, function* () {
        const bluetoothDevice = yield* request(() => this.adapter.requestDevice({
          filters: [{ services: [PROVISIONING_UUIDS.service] }],
        }))
        if (!bluetoothDevice.gatt)
          return yield* Effect.fail(new DeviceProvisioningError({ code: 'connection-failed' }))
        const gatt = bluetoothDevice.gatt
        const server = yield* request(async (signal) => {
          const connected = await gatt.connect()
          // Web Bluetooth cannot abort connect(); reclaim a server that arrives after cancellation.
          if (signal.aborted) {
            if (connected.connected)
              connected.disconnect()
          }
          else {
            resource.server = connected
          }
          return connected
        })
        const service = yield* request(() => server.getPrimaryService(PROVISIONING_UUIDS.service))
        const [infoCharacteristic, configCharacteristic, applyCharacteristic, statusCharacteristic] = yield* Effect.all([
          request(() => service.getCharacteristic(PROVISIONING_UUIDS.deviceInfo)),
          request(() => service.getCharacteristic(PROVISIONING_UUIDS.publicConfig)),
          request(() => service.getCharacteristic(PROVISIONING_UUIDS.configApply)),
          request(() => service.getCharacteristic(PROVISIONING_UUIDS.status)),
        ], { concurrency: 'unbounded' })
        yield* request(() => statusCharacteristic.startNotifications())
        const [infoValue, configValue] = yield* Effect.all([
          request(() => infoCharacteristic.readValue()),
          request(() => configCharacteristic.readValue()),
        ], { concurrency: 'unbounded' })
        return yield* Effect.try({
          try: () => {
            const info = parseDeviceInfoEnvelope(decodeEnvelope(viewBytes(infoValue)))
            const config = parsePublicConfigEnvelope(decodeEnvelope(viewBytes(configValue)))
            const connection = new DeviceProvisioningConnection(
              { config, info, name: bluetoothDevice.name ?? config.deviceName },
              bluetoothDevice,
              server,
              applyCharacteristic,
              statusCharacteristic,
            )
            resource.transferred = true
            return connection
          },
          catch: cause => toProvisioningError('protocol-error', cause),
        })
      }),
      resource => Effect.sync(() => {
        if (!resource.transferred && resource.server?.connected)
          resource.server.disconnect()
      }),
    )
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
