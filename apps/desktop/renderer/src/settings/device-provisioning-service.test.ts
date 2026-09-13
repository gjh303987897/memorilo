import type { ApplyConfigEnvelope, ChunkFrame } from '@memorilo/device-provisioning'
import type {
  BluetoothAdapter,
  BluetoothCharacteristicAdapter,
  BluetoothDeviceAdapter,
  BluetoothServerAdapter,
  BluetoothServiceAdapter,
} from './device-provisioning-service'
import { decodeFrame, encodeFrames, parseApplyConfigEnvelope, reassembleFrames } from '@memorilo/device-provisioning'
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
    return this.value ?? dataView(new Uint8Array())
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

afterEach(() => vi.useRealTimers())

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

describe('deviceProvisioningService', () => {
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
      wifiSsid: null,
      wifiPasswordIsSet: false,
      todoSyncMqttBrokerUrl: null,
      todoSyncMqttTopic: null,
      todoSyncMqttUsername: null,
      todoSyncEnabled: false,
      todoSyncUrl: '',
      todoSyncTokenIsSet: false,
      todoSyncPollIntervalSeconds: 900,
      todoSyncView: 'today',
    }))
    const apply = new FakeCharacteristic()
    const status = new FakeCharacteristic()
    const configContinuation = new FakeCharacteristic()
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
        error: null,
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
