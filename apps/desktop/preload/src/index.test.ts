import type { DesktopApi, DesktopNoteExternalUpdate, DesktopProvisioningDevice, DesktopProvisioningPairingRequest, DesktopSyncServerEvent } from './contract'
import { desktopProvisioningChannels } from '@memorilo/desktop-api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  ipcInvoke: vi.fn(),
  ipcOn: vi.fn(),
  ipcRemoveListener: vi.fn(),
  ipcSend: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.ipcInvoke,
    on: mocks.ipcOn,
    removeListener: mocks.ipcRemoveListener,
    send: mocks.ipcSend,
  },
}))

await import('./index')

function exposedApi(): DesktopApi {
  const exposed = mocks.exposeInMainWorld.mock.calls.find(([name]) => name === 'desktop')?.[1]
  if (!exposed)
    throw new Error('Preload did not expose the desktop API')
  return exposed as DesktopApi
}

beforeEach(() => {
  mocks.ipcInvoke.mockReset()
  mocks.ipcRemoveListener.mockClear()
  mocks.ipcSend.mockClear()
})

describe('preload IPC bridge', () => {
  it('exposes narrow Bluetooth selection and pairing contracts with removable listeners', async () => {
    mocks.ipcInvoke.mockResolvedValue(undefined)
    const api = exposedApi().deviceProvisioning

    await api.selectDevice('device-1')
    await api.respondToPairing({ confirmed: true, pin: '123456', requestId: 'pairing-1' })
    await api.cancelSelection()
    mocks.ipcInvoke.mockResolvedValueOnce('generated-token')
    await expect(api.generateLocalManagementToken()).resolves.toBe('generated-token')
    mocks.ipcInvoke.mockResolvedValueOnce(true)
    await expect(api.hasLocalManagementToken('device-1')).resolves.toBe(true)
    await api.saveLocalManagementToken('device-1', 'a'.repeat(32))
    await api.clearLocalManagementToken('device-1')
    const target = { address: '192.168.4.23', deviceId: 'device-1' }
    await api.loadGallery(target)
    await api.uploadGalleryAsset({
      ...target,
      bytes: new Uint8Array(30_000),
      createdAtUnixSeconds: 1,
      name: 'Image',
    })
    await api.deleteGalleryAsset(target, 1)
    await api.reorderGallery(target, [1])
    await api.setGallerySlideshow(target, 300)

    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.selectDevice, 'device-1')
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.respondToPairing, {
      confirmed: true,
      pin: '123456',
      requestId: 'pairing-1',
    })
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.selectDevice, null)
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.generateLocalManagementToken)
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.hasLocalManagementToken, 'device-1')
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.saveLocalManagementToken, {
      deviceId: 'device-1',
      token: 'a'.repeat(32),
    })
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.clearLocalManagementToken, 'device-1')
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.loadGallery, target)
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.deleteGalleryAsset, { ...target, id: 1 })
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.reorderGallery, { ...target, order: [1] })
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(desktopProvisioningChannels.setGallerySlideshow, {
      ...target,
      intervalSeconds: 300,
    })

    const deviceListener = vi.fn()
    const stopDevices = api.subscribeDevices(deviceListener)
    const deviceRegistration = mocks.ipcOn.mock.calls.find(([channel]) => channel === desktopProvisioningChannels.devicesChanged)
    const handleDevices = deviceRegistration?.[1] as ((event: unknown, devices: readonly DesktopProvisioningDevice[]) => void) | undefined
    if (!handleDevices)
      throw new Error('Preload did not register the Bluetooth device list channel')
    const devices = [{ deviceId: 'device-1', deviceName: 'Desk display' }]
    handleDevices({}, devices)
    expect(deviceListener).toHaveBeenCalledWith(devices)
    stopDevices()
    expect(mocks.ipcRemoveListener).toHaveBeenCalledWith(desktopProvisioningChannels.devicesChanged, handleDevices)

    const pairingListener = vi.fn()
    const stopPairing = api.subscribePairing(pairingListener)
    const pairingRegistration = mocks.ipcOn.mock.calls.find(([channel]) => channel === desktopProvisioningChannels.pairingRequested)
    const handlePairing = pairingRegistration?.[1] as ((event: unknown, request: DesktopProvisioningPairingRequest) => void) | undefined
    if (!handlePairing)
      throw new Error('Preload did not register the Bluetooth pairing channel')
    const request: DesktopProvisioningPairingRequest = {
      deviceId: 'device-1',
      pairingKind: 'confirmPin',
      pin: '123456',
      requestId: 'pairing-1',
    }
    handlePairing({}, request)
    expect(pairingListener).toHaveBeenCalledWith(request)
    stopPairing()
    expect(mocks.ipcRemoveListener).toHaveBeenCalledWith(desktopProvisioningChannels.pairingRequested, handlePairing)
  })

  it('invokes the stable application-owned Fetch channel with the original request', async () => {
    const request = {
      body: '{"args":[]}',
      headers: [['content-type', 'application/json']] as const,
      method: 'POST',
      url: 'memorilo://api/rpc/notes/openMostRecentNote',
    }
    mocks.ipcInvoke.mockResolvedValueOnce({
      status: 'success',
      value: { body: '{}', headers: [], status: 200, statusText: 'OK' },
    })
    await expect(exposedApi().request(request)).resolves.toEqual({
      body: '{}',
      headers: [],
      status: 200,
      statusText: 'OK',
    })
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(
      'memorilo:invoke:transport:fetch',
      request,
    )
  })

  it('waits for all Note save listeners and acknowledges the correlated request', async () => {
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)
    const unsubscribeFirst = exposedApi().subscribeNoteSaveRequests(first)
    const unsubscribeSecond = exposedApi().subscribeNoteSaveRequests(second)
    const registration = mocks.ipcOn.mock.calls.find(([channel]) => channel === 'memorilo:note-save-request')
    const handler = registration?.[1] as ((event: unknown, request: { requestId: string }) => Promise<void>) | undefined
    if (!handler)
      throw new Error('Preload did not register the Note save request channel')

    await handler({}, { requestId: 'request-1' })

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(mocks.ipcSend).toHaveBeenCalledWith('memorilo:note-save-result', {
      requestId: 'request-1',
      status: 'saved',
    })
    unsubscribeFirst()
    unsubscribeSecond()
    await handler({}, { requestId: 'request-2' })
    expect(first).toHaveBeenCalledOnce()
  })

  it('reports a failed Note save instead of acknowledging success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unsubscribe = exposedApi().subscribeNoteSaveRequests(() => Promise.reject(new Error('disk full')))
    const registration = mocks.ipcOn.mock.calls.find(([channel]) => channel === 'memorilo:note-save-request')
    const handler = registration?.[1] as ((event: unknown, request: { requestId: string }) => Promise<void>) | undefined
    if (!handler)
      throw new Error('Preload did not register the Note save request channel')

    await handler({}, { requestId: 'request-failed' })

    expect(mocks.ipcSend).toHaveBeenCalledWith('memorilo:note-save-result', {
      message: 'disk full',
      requestId: 'request-failed',
      status: 'failed',
    })
    unsubscribe()
  })

  it('serializes overlapping Note save requests', async () => {
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    const listener = vi.fn(async () => {
      calls += 1
      if (calls === 1)
        await firstReleased
    })
    const unsubscribe = exposedApi().subscribeNoteSaveRequests(listener)
    const registration = mocks.ipcOn.mock.calls.find(([channel]) => channel === 'memorilo:note-save-request')
    const handler = registration?.[1] as ((event: unknown, request: { requestId: string }) => Promise<void>) | undefined
    if (!handler)
      throw new Error('Preload did not register the Note save request channel')

    const first = handler({}, { requestId: 'request-serial-1' })
    const second = handler({}, { requestId: 'request-serial-2' })
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    releaseFirst()
    await Promise.all([first, second])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(mocks.ipcSend).toHaveBeenNthCalledWith(1, 'memorilo:note-save-result', {
      requestId: 'request-serial-1',
      status: 'saved',
    })
    expect(mocks.ipcSend).toHaveBeenNthCalledWith(2, 'memorilo:note-save-result', {
      requestId: 'request-serial-2',
      status: 'saved',
    })
    unsubscribe()
  })

  it('subscribes to the external Note update channel and removes the same handler', () => {
    const listener = vi.fn()
    const unsubscribe = exposedApi().subscribeNoteUpdates(listener)
    const registration = mocks.ipcOn.mock.calls.find(([channel]) => channel === 'memorilo:note-update')
    const handler = registration?.[1] as ((event: unknown, update: DesktopNoteExternalUpdate) => void) | undefined
    if (!handler)
      throw new Error('Preload did not register the external Note update channel')
    const update = { noteId: 'note-1', update: Uint8Array.from([1, 2, 3]), updatedAt: 42 }

    handler({}, update)
    expect(listener).toHaveBeenCalledWith(update)
    unsubscribe()
    expect(mocks.ipcRemoveListener).toHaveBeenCalledWith('memorilo:note-update', handler)
  })

  it('forwards Sync Server policy and reset events and removes the same handler', () => {
    const listener = vi.fn()
    const unsubscribe = exposedApi().subscribeSyncServerEvents(listener)
    const registration = mocks.ipcOn.mock.calls.find(([channel]) => channel === 'memorilo:sync-server-event')
    const handler = registration?.[1] as ((event: unknown, update: DesktopSyncServerEvent) => void) | undefined
    if (!handler)
      throw new Error('Preload did not register the Sync Server event channel')
    const event: DesktopSyncServerEvent = {
      previousGeneration: 0,
      status: {
        configured: true,
        enabled: true,
        error: null,
        generation: 1,
        membershipEpoch: 2,
        modes: ['authoritative'],
        peerId: 'server-peer',
        policyEpoch: 1,
        state: 'connecting',
        url: 'wss://sync.example.test',
      },
      type: 'account-data-reset',
    }

    handler({}, event)
    expect(listener).toHaveBeenCalledWith(event)
    unsubscribe()
    expect(mocks.ipcRemoveListener).toHaveBeenCalledWith('memorilo:sync-server-event', handler)
  })
})
