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

import { describe, expect, it, vi } from 'vitest'
import { DeviceProvisioningService } from './device-provisioning-service'

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

describe('deviceProvisioningService', () => {
  it('connects through the injected adapter, applies framed config, and closes resources', async () => {
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
    const apply = new FakeCharacteristic()
    const status = new FakeCharacteristic()
    const characteristics = [info, config, apply, status]
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
      forget,
      gatt: { connect: vi.fn(async () => server) },
      name: 'Memorilo Setup',
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
