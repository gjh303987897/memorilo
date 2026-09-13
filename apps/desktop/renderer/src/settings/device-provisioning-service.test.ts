import type { ApplyConfigEnvelope, ChunkFrame } from '@memorilo/device-provisioning'
import type {
  BluetoothAdapter,
  BluetoothCharacteristicAdapter,
  BluetoothDeviceAdapter,
  BluetoothServerAdapter,
  BluetoothServiceAdapter,
} from './device-provisioning-service'
import { decodeFrame, encodeFrames, parseApplyConfigEnvelope, PROVISIONING_UUIDS, reassembleFrames } from '@memorilo/device-provisioning'
import { Effect } from 'effect'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceProvisioningConnection, DeviceProvisioningService } from './device-provisioning-service'

class FakeCharacteristic extends EventTarget implements BluetoothCharacteristicAdapter {
  value: DataView | null = null
  readonly writes: Uint8Array[] = []
  onWrite?: (value: Uint8Array) => void

  constructor(value?: Uint8Array) {
    super()
    if (value)
      this.value = dataView(value)
  }

  async readValue(): Promise<DataView> {
    if (!this.value)
      throw new Error('missing value')
    return this.value
  }

  async startNotifications(): Promise<this> {
    return this
  }

  async writeValueWithResponse(value: BufferSource): Promise<void> {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    this.writes.push(bytes.slice())
    this.onWrite?.(bytes)
  }

  emit(value: Uint8Array): void {
    this.value = dataView(value)
    this.dispatchEvent(new Event('characteristicvaluechanged'))
  }
}

function framed(value: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(value))
  return Uint8Array.from(encodeFrames(1, json, 24).flatMap(frame => [...frame]))
}

function dataView(value: Uint8Array): DataView {
  return new DataView(value.buffer, value.byteOffset, value.byteLength)
}

afterEach(() => {
  vi.useRealTimers()
  sessionStorage.removeItem('memorilo:ble-diagnostic:connect')
})

function stalledConnection() {
  const events = new EventTarget()
  const apply = new FakeCharacteristic()
  const status = new FakeCharacteristic()
  let releaseWrite!: () => void
  const write = vi.spyOn(apply, 'writeValueWithResponse').mockImplementation(() => new Promise<void>((resolve) => {
    releaseWrite = resolve
  }))
  const server: BluetoothServerAdapter = {
    connected: true,
    disconnect: vi.fn(() => { server.connected = false }),
    getPrimaryService: vi.fn(),
  }
  const connection = new DeviceProvisioningConnection({
    name: 'Memorilo-a1b2',
    info: { capabilities: ['config-v1'], configRevision: 1, configSchemaVersion: 2, deviceId: 'device-1', firmwareVersion: '0.1.0', protocolVersion: 1 },
    config: {
      configSchemaVersion: 2,
      deviceName: 'Desk',
      idleSleepSeconds: 600,
      localManagementTokenIsSet: false,
      protocolVersion: 1,
      revision: 1,
      selectionPolicy: 'Remember',
      timezone: 'UTC',
      wifiPasswordIsSet: false,
      todoSyncEnabled: false,
      todoSyncUrl: '',
      todoSyncTokenIsSet: false,
      todoSyncPollIntervalSeconds: 900,
      todoSyncView: 'today',
    },
  }, events, server, apply, status)
  return { connection, events, releaseWrite: () => releaseWrite(), server, status, write }
}

function provisioningHarness() {
  const info = new FakeCharacteristic(framed({
    capabilities: ['config-v1'],
    configRevision: 2,
    configSchemaVersion: 2,
    deviceId: 'device-1',
    firmwareVersion: '0.1.0',
    protocolVersion: 1,
  }))
  const config = new FakeCharacteristic(framed({
    configSchemaVersion: 2,
    deviceName: 'Desk',
    idleSleepSeconds: 600,
    localManagementTokenIsSet: false,
    protocolVersion: 1,
    revision: 2,
    selectionPolicy: 'Remember',
    timezone: 'Asia/Shanghai',
    todoSyncEnabled: false,
    todoSyncPollIntervalSeconds: 900,
    todoSyncTokenIsSet: false,
    todoSyncUrl: '',
    todoSyncView: 'today',
    wifiPasswordIsSet: false,
  }))
  const configContinuation = new FakeCharacteristic(new Uint8Array())
  const apply = new FakeCharacteristic()
  const status = new FakeCharacteristic()
  const characteristics = new Map([
    ['7b7a1001-6c6f-4d65-8a8b-6d656d6f7269', info],
    ['7b7a1002-6c6f-4d65-8a8b-6d656d6f7269', config],
    ['7b7a1005-6c6f-4d65-8a8b-6d656d6f7269', configContinuation],
    ['7b7a1003-6c6f-4d65-8a8b-6d656d6f7269', apply],
    ['7b7a1004-6c6f-4d65-8a8b-6d656d6f7269', status],
  ])
  const service: BluetoothServiceAdapter = {
    getCharacteristic: vi.fn(async uuid => characteristics.get(uuid)!),
  }
  const server: BluetoothServerAdapter = {
    connected: true,
    disconnect: vi.fn(() => { server.connected = false }),
    getPrimaryService: vi.fn(async () => service),
  }
  const connect = vi.fn(async () => {
    server.connected = true
    return server
  })
  const device: BluetoothDeviceAdapter = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    gatt: { connect },
  }
  const adapter: BluetoothAdapter = { requestDevice: vi.fn(async () => device) }
  const bridge = {
    cancelSelection: vi.fn(async () => undefined),
    clearLocalManagementToken: vi.fn(async () => undefined),
    deleteGalleryAsset: vi.fn(async () => undefined),
    generateLocalManagementToken: vi.fn(async () => 'unused'),
    hasLocalManagementToken: vi.fn(async () => false),
    loadGallery: vi.fn(async () => { throw new Error('unused') }),
    loadStatus: vi.fn(async () => { throw new Error('unused') }),
    loadTodos: vi.fn(async () => { throw new Error('unused') }),
    loadTodoTarget: vi.fn(async () => ({ status: null, target: null })),
    nextDevicePage: vi.fn(async () => undefined),
    pushTodos: vi.fn(async () => undefined),
    refreshDevice: vi.fn(async () => undefined),
    reorderGallery: vi.fn(async () => undefined),
    respondToPairing: vi.fn(async () => undefined),
    saveLocalManagementToken: vi.fn(async () => undefined),
    saveTodoTarget: vi.fn(async () => undefined),
    selectDevice: vi.fn(async () => undefined),
    setGallerySlideshow: vi.fn(async () => undefined),
    sleepDevice: vi.fn(async () => undefined),
    subscribeDevices: vi.fn(() => vi.fn()),
    subscribePairing: vi.fn(() => vi.fn()),
    uploadGalleryAsset: vi.fn(async () => undefined),
  }
  return {
    connect,
    info,
    config,
    configContinuation,
    service,
    status,
    provisioning: new DeviceProvisioningService(adapter, bridge),
    server,
  }
}

function connectDiagnostics(): Array<{
  attempt: number
  domException?: { message: string, name: string }
  elapsedMs: number
  outcome: 'failure' | 'start' | 'success'
  stage: string
}> {
  return JSON.parse(sessionStorage.getItem('memorilo:ble-diagnostic:connect') ?? '[]')
}

describe('deviceProvisioningService', () => {
  it('discovers characteristics sequentially for CoreBluetooth stability', async () => {
    const harness = provisioningHarness()
    const originalGetCharacteristic = harness.service.getCharacteristic
    let releaseInfo!: () => void
    const infoReady = new Promise<void>((resolve) => {
      releaseInfo = resolve
    })
    const calls: string[] = []
    harness.service.getCharacteristic = vi.fn(async (uuid) => {
      calls.push(uuid)
      if (uuid === PROVISIONING_UUIDS.deviceInfo)
        await infoReady
      return originalGetCharacteristic(uuid)
    })

    const result = Effect.runPromise(harness.provisioning.connect())
    await vi.waitFor(() => expect(calls).toEqual([PROVISIONING_UUIDS.deviceInfo]))
    releaseInfo()
    const connection = await result

    expect(calls).toEqual([
      PROVISIONING_UUIDS.deviceInfo,
      PROVISIONING_UUIDS.publicConfig,
      PROVISIONING_UUIDS.publicConfigContinuation,
      PROVISIONING_UUIDS.configApply,
      PROVISIONING_UUIDS.status,
    ])
    await Effect.runPromise(connection.close())
  })

  it('starts notifications and reads provisioning values sequentially', async () => {
    const harness = provisioningHarness()
    const calls: string[] = []
    let releaseNotifications!: () => void
    let releaseInfo!: () => void
    const notificationsReady = new Promise<void>((resolve) => {
      releaseNotifications = resolve
    })
    const infoReady = new Promise<void>((resolve) => {
      releaseInfo = resolve
    })
    const originalInfoRead = harness.info.readValue.bind(harness.info)
    const originalConfigRead = harness.config.readValue.bind(harness.config)
    const originalContinuationRead = harness.configContinuation.readValue.bind(harness.configContinuation)
    vi.spyOn(harness.status, 'startNotifications').mockImplementation(async () => {
      calls.push('notifications')
      await notificationsReady
      return harness.status
    })
    vi.spyOn(harness.info, 'readValue').mockImplementation(async () => {
      calls.push('read-info')
      await infoReady
      return originalInfoRead()
    })
    vi.spyOn(harness.config, 'readValue').mockImplementation(async () => {
      calls.push('read-config')
      return originalConfigRead()
    })
    vi.spyOn(harness.configContinuation, 'readValue').mockImplementation(async () => {
      calls.push('read-continuation')
      return originalContinuationRead()
    })

    const result = Effect.runPromise(harness.provisioning.connect())
    await vi.waitFor(() => expect(calls).toEqual(['notifications']))
    releaseNotifications()
    await vi.waitFor(() => expect(calls).toEqual(['notifications', 'read-info']))
    releaseInfo()
    const connection = await result

    expect(calls).toEqual(['notifications', 'read-info', 'read-config', 'read-continuation'])
    await Effect.runPromise(connection.close())
  })

  it('retries the selected device after the first connection attempt fails', async () => {
    vi.useFakeTimers()
    const harness = provisioningHarness()
    harness.connect.mockRejectedValueOnce(new DOMException('Temporary GATT failure', 'NetworkError'))

    const result = Effect.runPromise(harness.provisioning.connect())
    await vi.waitFor(() => expect(harness.connect).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(501)
    await vi.waitFor(() => expect(harness.connect).toHaveBeenCalledTimes(2))
    const connection = await result

    expect(harness.connect).toHaveBeenCalledTimes(2)
    expect(connectDiagnostics()).toContainEqual(expect.objectContaining({
      attempt: 1,
      domException: { message: 'Temporary GATT failure', name: 'NetworkError' },
      outcome: 'failure',
      stage: 'connect',
    }))
    await Effect.runPromise(connection.close())
  })

  it('stops connection retries when the caller aborts', async () => {
    vi.useFakeTimers()
    const harness = provisioningHarness()
    harness.connect.mockRejectedValue(new DOMException('Temporary GATT failure', 'NetworkError'))
    const controller = new AbortController()

    const result = Effect.runPromiseExit(harness.provisioning.connect(), { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.connect).toHaveBeenCalledOnce()
    controller.abort()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(await result).toMatchObject({ _tag: 'Failure' })
    expect(harness.connect).toHaveBeenCalledOnce()
  })

  it.each([
    ['service', (harness: ReturnType<typeof provisioningHarness>) => {
      vi.mocked(harness.server.getPrimaryService).mockRejectedValue(new DOMException('Service unavailable', 'NetworkError'))
    }],
    ['read', (harness: ReturnType<typeof provisioningHarness>) => {
      vi.spyOn(harness.info, 'readValue').mockRejectedValue(new DOMException('Read failed', 'NetworkError'))
    }],
  ] as const)('identifies a %s-stage initialization failure', async (stage, fail) => {
    const harness = provisioningHarness()
    fail(harness)
    const controller = new AbortController()

    const result = Effect.runPromiseExit(harness.provisioning.connect(), { signal: controller.signal })
    await vi.waitFor(() => expect(connectDiagnostics()).toContainEqual(expect.objectContaining({
      outcome: 'failure',
      stage,
    })))
    controller.abort()

    expect(await result).toMatchObject({ _tag: 'Failure' })
  })

  it('bounds a stalled GATT write and stops subsequent chunks after timeout', async () => {
    vi.useFakeTimers()
    const harness = stalledConnection()
    const result = Effect.runPromise(harness.connection.apply({ deviceName: 'x'.repeat(300) }).pipe(Effect.result))
    await vi.advanceTimersByTimeAsync(15_001)
    expect(await result).toMatchObject({ _tag: 'Failure', failure: { code: 'timeout' } })
    expect(harness.server.disconnect).toHaveBeenCalledOnce()
    harness.releaseWrite()
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.write).toHaveBeenCalledOnce()
  })

  it('interrupts pending writes and notifies subscribers when the device disconnects', async () => {
    const harness = stalledConnection()
    const disconnected = vi.fn()
    harness.connection.subscribeDisconnected(disconnected)
    const result = Effect.runPromise(harness.connection.apply({ deviceName: 'Desk' }).pipe(Effect.result))
    await vi.waitFor(() => expect(harness.write).toHaveBeenCalledOnce())
    harness.server.connected = false
    harness.events.dispatchEvent(new Event('gattserverdisconnected'))
    expect(await result).toMatchObject({ _tag: 'Failure', failure: { code: 'connection-failed' } })
    expect(harness.connection.connected).toBe(false)
    expect(disconnected).toHaveBeenCalledOnce()
    await Effect.runPromise(harness.connection.close())
    expect(disconnected).toHaveBeenCalledOnce()
    harness.releaseWrite()
  })

  it('disconnects and cancels later writes when the caller interrupts apply', async () => {
    const harness = stalledConnection()
    const controller = new AbortController()
    const result = Effect.runPromiseExit(harness.connection.apply({ deviceName: 'x'.repeat(300) }), { signal: controller.signal })
    await vi.waitFor(() => expect(harness.write).toHaveBeenCalledOnce())
    controller.abort()
    expect(await result).toMatchObject({ _tag: 'Failure' })
    expect(harness.server.disconnect).toHaveBeenCalledOnce()
    harness.releaseWrite()
    await Promise.resolve()
    expect(harness.write).toHaveBeenCalledOnce()
  })
  it.each(['normal', 'selection', 'connect', 'service', 'characteristics', 'notifications', 'read'])('owns GATT resources during %s', async (stage) => {
    const info = new FakeCharacteristic(framed({
      capabilities: ['config-v1'],
      configRevision: 2,
      configSchemaVersion: 2,
      deviceId: 'device-1',
      firmwareVersion: '0.1.0',
      protocolVersion: 1,
    }))
    const config = new FakeCharacteristic(framed({
      configSchemaVersion: 2,
      deviceName: 'Desk',
      idleSleepSeconds: 600,
      localManagementTokenIsSet: false,
      protocolVersion: 1,
      revision: 2,
      selectionPolicy: 'Remember',
      timezone: 'Asia/Shanghai',
      wifiPasswordIsSet: false,
      todoSyncEnabled: false,
      todoSyncUrl: '',
      todoSyncTokenIsSet: false,
      todoSyncPollIntervalSeconds: 900,
      todoSyncView: 'today',
    }))
    const configContinuation = new FakeCharacteristic(new Uint8Array())
    const apply = new FakeCharacteristic()
    const status = new FakeCharacteristic()
    const characteristics = [info, config, configContinuation, apply, status]
    let characteristicIndex = 0
    const service: BluetoothServiceAdapter = {
      getCharacteristic: vi.fn(async () => characteristics[characteristicIndex++]!),
    }
    const disconnect = vi.fn()
    const server: BluetoothServerAdapter = {
      connected: true,
      disconnect,
      getPrimaryService: vi.fn(async () => service),
    }
    const forget = vi.fn(async () => undefined)
    const device: BluetoothDeviceAdapter = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      forget,
      gatt: { connect: vi.fn(async () => server) },
      name: 'Memorilo-a1b2',
    }
    const adapter: BluetoothAdapter = {
      requestDevice: vi.fn(async () => device),
    }
    const bridge = {
      cancelSelection: vi.fn(async () => undefined),
      clearLocalManagementToken: vi.fn(async () => undefined),
      deleteGalleryAsset: vi.fn(async () => undefined),
      generateLocalManagementToken: vi.fn(async () => 'a'.repeat(32)),
      hasLocalManagementToken: vi.fn(async () => false),
      loadGallery: vi.fn(async () => { throw new Error('unused') }),
      loadStatus: vi.fn(async () => { throw new Error('unused') }),
      loadTodos: vi.fn(async () => { throw new Error('unused') }),
      loadTodoTarget: vi.fn(async () => ({ status: null, target: null })),
      pushTodos: vi.fn(async () => undefined),
      refreshDevice: vi.fn(async () => undefined),
      nextDevicePage: vi.fn(async () => undefined),
      sleepDevice: vi.fn(async () => undefined),
      reorderGallery: vi.fn(async () => undefined),
      respondToPairing: vi.fn(async () => undefined),
      saveLocalManagementToken: vi.fn(async () => undefined),
      saveTodoTarget: vi.fn(async () => undefined),
      setGallerySlideshow: vi.fn(async () => undefined),
      selectDevice: vi.fn(async () => undefined),
      subscribeDevices: vi.fn(() => vi.fn()),
      subscribePairing: vi.fn(() => vi.fn()),
      uploadGalleryAsset: vi.fn(async () => undefined),
    }
    const provisioning = new DeviceProvisioningService(adapter, bridge)
    if (stage !== 'normal') {
      let release!: () => void
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const stall = async <T>(value: T): Promise<T> => {
        await pending
        return value
      }
      const blocked = stage === 'selection'
        ? vi.spyOn(adapter, 'requestDevice').mockImplementation(() => stall(device))
        : stage === 'connect'
          ? vi.spyOn(device.gatt!, 'connect').mockImplementation(() => stall(server))
          : stage === 'service'
            ? vi.spyOn(server, 'getPrimaryService').mockImplementation(() => stall(service))
            : stage === 'characteristics'
              ? vi.spyOn(service, 'getCharacteristic').mockImplementation(() => stall(characteristics[characteristicIndex++]!))
              : stage === 'notifications'
                ? vi.spyOn(status, 'startNotifications').mockImplementation(() => stall(status))
                : vi.spyOn(info, 'readValue').mockImplementation(() => stall(info.value!))
      const controller = new AbortController()
      const result = Effect.runPromiseExit(provisioning.connect(), { signal: controller.signal })
      await vi.waitFor(() => expect(blocked).toHaveBeenCalled())
      controller.abort()
      expect(await result).toMatchObject({ _tag: 'Failure' })
      if (stage !== 'selection' && stage !== 'connect')
        expect(disconnect).toHaveBeenCalledOnce()
      release()
      await vi.waitFor(() => expect(blocked.mock.settledResults[0]?.type).toBe('fulfilled'))
      await vi.waitFor(() => {
        if (stage === 'selection')
          expect(device.gatt!.connect).not.toHaveBeenCalled()
        else
          expect(disconnect).toHaveBeenCalledOnce()
      })
      expect(device.addEventListener).not.toHaveBeenCalled()
      return
    }
    const connection = await Effect.runPromise(provisioning.connect())

    expect(connection.device.info.deviceId).toBe('device-1')
    const frames: ChunkFrame[] = []
    apply.onWrite = (bytes) => {
      frames.push(decodeFrame(bytes))
      if (frames.length !== frames[0]?.count)
        return
      const request: ApplyConfigEnvelope = parseApplyConfigEnvelope(reassembleFrames(frames))
      status.emit(framed({
        protocolVersion: 1,
        requestId: request.requestId,
        revision: 3,
        status: 'accepted',
      }))
    }
    await expect(Effect.runPromise(connection.apply({ deviceName: 'Kitchen'.repeat(50) }))).resolves.toMatchObject({
      revision: 3,
      status: 'accepted',
    })
    expect(connection.device.config.revision).toBe(3)
    expect(apply.writes.length).toBeGreaterThan(1)

    await Effect.runPromise(connection.forget())
    expect(disconnect).toHaveBeenCalledOnce()
    expect(forget).toHaveBeenCalledOnce()
  })

  it('routes device selection and pairing responses through the narrow bridge', async () => {
    const bridge = {
      cancelSelection: vi.fn(async () => undefined),
      clearLocalManagementToken: vi.fn(async () => undefined),
      deleteGalleryAsset: vi.fn(async () => undefined),
      generateLocalManagementToken: vi.fn(async () => 'a'.repeat(32)),
      hasLocalManagementToken: vi.fn(async () => false),
      loadGallery: vi.fn(async () => { throw new Error('unused') }),
      loadStatus: vi.fn(async () => { throw new Error('unused') }),
      loadTodos: vi.fn(async () => { throw new Error('unused') }),
      loadTodoTarget: vi.fn(async () => ({ status: null, target: null })),
      pushTodos: vi.fn(async () => undefined),
      refreshDevice: vi.fn(async () => undefined),
      nextDevicePage: vi.fn(async () => undefined),
      sleepDevice: vi.fn(async () => undefined),
      reorderGallery: vi.fn(async () => undefined),
      respondToPairing: vi.fn(async () => undefined),
      saveLocalManagementToken: vi.fn(async () => undefined),
      saveTodoTarget: vi.fn(async () => undefined),
      setGallerySlideshow: vi.fn(async () => undefined),
      selectDevice: vi.fn(async () => undefined),
      subscribeDevices: vi.fn(() => vi.fn()),
      subscribePairing: vi.fn(() => vi.fn()),
      uploadGalleryAsset: vi.fn(async () => undefined),
    }
    const adapter: BluetoothAdapter = { requestDevice: vi.fn() }
    const provisioning = new DeviceProvisioningService(adapter, bridge)

    await Effect.runPromise(provisioning.selectDevice({ deviceId: 'device-1', deviceName: 'Desk' }))
    await Effect.runPromise(provisioning.respondToPairing({
      confirmed: true,
      pin: '123456',
      requestId: 'pairing-1',
    }))
    await Effect.runPromise(provisioning.cancelSelection())

    expect(bridge.selectDevice).toHaveBeenCalledWith('device-1')
    expect(bridge.respondToPairing).toHaveBeenCalledWith(expect.objectContaining({ pin: '123456' }))
    expect(bridge.cancelSelection).toHaveBeenCalledOnce()
  })

  it('routes local management credentials through the secure main-process bridge', async () => {
    const bridge = {
      cancelSelection: vi.fn(async () => undefined),
      clearLocalManagementToken: vi.fn(async () => undefined),
      deleteGalleryAsset: vi.fn(async () => undefined),
      generateLocalManagementToken: vi.fn(async () => 'a'.repeat(32)),
      hasLocalManagementToken: vi.fn(async () => true),
      loadGallery: vi.fn(async () => { throw new Error('unused') }),
      loadStatus: vi.fn(async () => { throw new Error('unused') }),
      loadTodos: vi.fn(async () => { throw new Error('unused') }),
      loadTodoTarget: vi.fn(async () => ({ status: null, target: null })),
      pushTodos: vi.fn(async () => undefined),
      refreshDevice: vi.fn(async () => undefined),
      nextDevicePage: vi.fn(async () => undefined),
      sleepDevice: vi.fn(async () => undefined),
      reorderGallery: vi.fn(async () => undefined),
      respondToPairing: vi.fn(async () => undefined),
      saveLocalManagementToken: vi.fn(async () => undefined),
      saveTodoTarget: vi.fn(async () => undefined),
      setGallerySlideshow: vi.fn(async () => undefined),
      selectDevice: vi.fn(async () => undefined),
      subscribeDevices: vi.fn(() => vi.fn()),
      subscribePairing: vi.fn(() => vi.fn()),
      uploadGalleryAsset: vi.fn(async () => undefined),
    }
    const provisioning = new DeviceProvisioningService({ requestDevice: vi.fn() }, bridge)

    await expect(Effect.runPromise(provisioning.generateLocalManagementToken())).resolves.toBe('a'.repeat(32))
    await expect(Effect.runPromise(provisioning.hasLocalManagementToken('device-1'))).resolves.toBe(true)
    await Effect.runPromise(provisioning.saveLocalManagementToken('device-1', 'a'.repeat(32)))
    await Effect.runPromise(provisioning.clearLocalManagementToken('device-1'))

    expect(bridge.saveLocalManagementToken).toHaveBeenCalledWith('device-1', 'a'.repeat(32))
    expect(bridge.clearLocalManagementToken).toHaveBeenCalledWith('device-1')
  })
})
