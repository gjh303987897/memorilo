import type { IpcMainInvokeEvent } from 'electron'
import { EventEmitter } from 'node:events'
import process from 'node:process'
import { desktopProvisioningChannels } from '@memorilo/desktop-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSettingsWindowController } from './settings-window'

const mocks = vi.hoisted(() => ({
  createWindow: vi.fn(),
  ipcHandle: vi.fn(),
  ipcRemoveHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: function BrowserWindow(...arguments_: unknown[]) {
    return mocks.createWindow(...arguments_)
  },
  ipcMain: {
    handle: mocks.ipcHandle,
    removeHandler: mocks.ipcRemoveHandler,
  },
}))

interface WindowHarness {
  pairingHandler: ((details: Electron.BluetoothPairingHandlerHandlerDetails, callback: (response: Electron.Response) => void) => void) | null
  session: EventEmitter & {
    setBluetoothPairingHandler: ReturnType<typeof vi.fn>
  }
  webContents: EventEmitter & {
    isDestroyed: ReturnType<typeof vi.fn>
    mainFrame: object
    send: ReturnType<typeof vi.fn>
    session: WindowHarness['session']
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
  window: EventEmitter & {
    destroy: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    isMinimized: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    webContents: WindowHarness['webContents']
  }
}

function createWindowHarness(): WindowHarness {
  const harness = {} as WindowHarness
  const session = Object.assign(new EventEmitter(), {
    setBluetoothPairingHandler: vi.fn((handler) => {
      harness.pairingHandler = handler
    }),
  })
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    mainFrame: {},
    send: vi.fn(),
    session,
    setWindowOpenHandler: vi.fn(),
  })
  const window = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    loadFile: vi.fn(async () => undefined),
    restore: vi.fn(),
    show: vi.fn(),
    webContents,
  })
  Object.assign(harness, { pairingHandler: null, session, webContents, window })
  return harness
}

function ipcHandler(channel: string): (event: IpcMainInvokeEvent, argument: unknown) => unknown {
  const registration = mocks.ipcHandle.mock.calls.find(([registeredChannel]) => registeredChannel === channel)
  const handler = registration?.[1]
  if (typeof handler !== 'function')
    throw new Error(`Missing IPC handler for ${channel}`)
  return handler
}

beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  mocks.createWindow.mockReset()
  mocks.ipcHandle.mockReset()
  mocks.ipcRemoveHandler.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('settings window Bluetooth provisioning', () => {
  it('routes LAN gallery upload progress only to the invoking settings renderer', async () => {
    const request = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const reader = (init?.body as ReadableStream<Uint8Array>).getReader()
      while (!(await reader.read()).done) {
        // Consume the actual streamed request body so each progress event is observable.
      }
      return new Response(null, { status: 202 })
    })
    vi.stubGlobal('fetch', request)
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const controller = createSettingsWindowController('C:\\app\\main', createCredentialStore())
    controller.show()
    const event = { sender: harness.webContents } as unknown as IpcMainInvokeEvent
    const token = await ipcHandler(desktopProvisioningChannels.generateLocalManagementToken)(event, undefined)
    await ipcHandler(desktopProvisioningChannels.saveLocalManagementToken)(event, {
      deviceId: 'device-1',
      token,
    })

    await ipcHandler(desktopProvisioningChannels.uploadGalleryAsset)(event, {
      address: '192.168.4.23',
      bytes: new Uint8Array(30_000),
      createdAtUnixSeconds: 1,
      deviceId: 'device-1',
      name: 'Image',
      requestId: 'upload-1',
    })

    const progress = harness.webContents.send.mock.calls
      .filter(([channel]) => channel === desktopProvisioningChannels.galleryUploadProgress)
      .map(([, update]) => update as { requestId: string, sentBytes: number, totalBytes: number })
    expect(progress.length).toBeGreaterThan(3)
    expect(progress[0]).toEqual({ requestId: 'upload-1', sentBytes: 0, totalBytes: 30_000 })
    expect(progress.at(-1)).toEqual({ requestId: 'upload-1', sentBytes: 30_000, totalBytes: 30_000 })
    expect(progress.every(update => update.requestId === 'upload-1')).toBe(true)
    controller.close()
  })

  it('routes Web Serial selection through the same device picker', async () => {
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const controller = createSettingsWindowController('C:\\app\\main', createCredentialStore())
    controller.show()

    const callback = vi.fn()
    const event = { preventDefault: vi.fn() }
    harness.session.emit('select-serial-port', event, [
      {
        displayName: 'Communications Port',
        portId: 'port-1',
        portName: 'COM1',
      },
      {
        displayName: 'USB Serial Device',
        portId: 'port-4',
        portName: 'COM4',
        productId: '1001',
        vendorId: '303A',
      },
    ], harness.webContents, callback)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(harness.webContents.send).toHaveBeenCalledWith(
      desktopProvisioningChannels.devicesChanged,
      { devices: [{ deviceId: 'port-4', deviceName: 'Memorilo · USB Serial/JTAG (COM4)', transport: 'serial' }], transport: 'serial' },
    )
    await ipcHandler(desktopProvisioningChannels.selectDevice)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      'port-4',
    )
    expect(callback).toHaveBeenCalledWith('port-4')
    controller.close()
  })

  it('accepts decimal USB IDs reported by Electron on Windows', async () => {
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const controller = createSettingsWindowController('C:\\app\\main', createCredentialStore())
    controller.show()

    const callback = vi.fn()
    const event = { preventDefault: vi.fn() }
    harness.session.emit('select-serial-port', event, [
      {
        displayName: 'USB Serial Device',
        portId: 'port-4-decimal',
        portName: 'COM4',
        // 0x303A/0x1001 expressed as decimal strings.
        productId: '4097',
        vendorId: '12346',
      },
    ], harness.webContents, callback)

    expect(harness.webContents.send).toHaveBeenCalledWith(
      desktopProvisioningChannels.devicesChanged,
      { devices: [{ deviceId: 'port-4-decimal', deviceName: 'Memorilo · USB Serial/JTAG (COM4)', transport: 'serial' }], transport: 'serial' },
    )
    await ipcHandler(desktopProvisioningChannels.selectDevice)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      'port-4-decimal',
    )
    expect(callback).toHaveBeenCalledWith('port-4-decimal')
    controller.close()
  })

  it('leaves pairing to the operating system on macOS', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const controller = createSettingsWindowController('/app/main', createCredentialStore())
    controller.show()
    expect(harness.session.setBluetoothPairingHandler).not.toHaveBeenCalled()
    controller.close()
  })
  it('routes validated device selection and PIN responses', async () => {
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const credentialStore = createCredentialStore()
    const controller = createSettingsWindowController('C:\\app\\main', credentialStore)
    controller.show()

    const selectCallback = vi.fn()
    const selectEvent = { preventDefault: vi.fn() }
    harness.webContents.emit('select-bluetooth-device', selectEvent, [{
      deviceId: 'device-1',
      deviceName: 'Desk display',
    }], selectCallback)
    await ipcHandler(desktopProvisioningChannels.selectDevice)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      'device-1',
    )
    expect(selectEvent.preventDefault).toHaveBeenCalledOnce()
    expect(selectCallback).toHaveBeenCalledWith('device-1')

    const pairingCallback = vi.fn()
    harness.pairingHandler?.({
      deviceId: 'device-1',
      frame: { top: harness.webContents.mainFrame } as unknown as Electron.WebFrameMain,
      pairingKind: 'providePin',
    }, pairingCallback)
    await ipcHandler(desktopProvisioningChannels.respondToPairing)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      { confirmed: true, pin: '123456', requestId: 'bluetooth-pairing-1' },
    )
    expect(pairingCallback).toHaveBeenCalledWith({ confirmed: true, pin: '123456' })

    const token = await ipcHandler(desktopProvisioningChannels.generateLocalManagementToken)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      undefined,
    )
    expect(token).toMatch(/^[\w-]{43}$/u)
    await ipcHandler(desktopProvisioningChannels.saveLocalManagementToken)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      { deviceId: 'device-1', token },
    )
    await expect(ipcHandler(desktopProvisioningChannels.hasLocalManagementToken)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      'device-1',
    )).resolves.toBe(true)
    await ipcHandler(desktopProvisioningChannels.clearLocalManagementToken)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      'device-1',
    )
    expect(credentialStore.save).toHaveBeenCalledWith('device-1', token)
    expect(credentialStore.clear).toHaveBeenCalledWith('device-1')
    controller.close()
  })

  it('keeps Bluetooth and USB Serial selections independent during a unified refresh', async () => {
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const controller = createSettingsWindowController('C:\\app\\main', createCredentialStore())
    controller.show()

    const bluetoothCallback = vi.fn()
    harness.webContents.emit('select-bluetooth-device', { preventDefault: vi.fn() }, [{
      deviceId: 'bluetooth-1',
      deviceName: 'Desk display',
    }], bluetoothCallback)

    const serialCallback = vi.fn()
    harness.session.emit('select-serial-port', { preventDefault: vi.fn() }, [{
      displayName: 'USB Serial Device',
      portId: 'serial-1',
      portName: 'COM4',
      productId: '1001',
      vendorId: '303A',
    }], harness.webContents, serialCallback)

    await ipcHandler(desktopProvisioningChannels.selectDevice)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      'serial-1',
    )
    expect(serialCallback).toHaveBeenCalledWith('serial-1')
    expect(bluetoothCallback).not.toHaveBeenCalled()

    await ipcHandler(desktopProvisioningChannels.selectDevice)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      'bluetooth-1',
    )
    expect(bluetoothCallback).toHaveBeenCalledWith('bluetooth-1')
    controller.close()
  })

  it('cancels pending platform callbacks when the settings window closes', () => {
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const controller = createSettingsWindowController('C:\\app\\main', createCredentialStore())
    controller.show()

    const selectCallback = vi.fn()
    harness.webContents.emit('select-bluetooth-device', { preventDefault: vi.fn() }, [{
      deviceId: 'device-1',
      deviceName: 'Desk display',
    }], selectCallback)
    const pairingCallback = vi.fn()
    harness.pairingHandler?.({
      deviceId: 'device-1',
      frame: { top: harness.webContents.mainFrame } as unknown as Electron.WebFrameMain,
      pairingKind: 'confirm',
    }, pairingCallback)

    harness.window.emit('closed')

    expect(selectCallback).toHaveBeenCalledWith('')
    expect(pairingCallback).toHaveBeenCalledWith({ confirmed: false })
    expect(harness.session.setBluetoothPairingHandler).toHaveBeenLastCalledWith(null)
    controller.close()
  })

  it('does not invoke a completed device selection callback again during close', async () => {
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const controller = createSettingsWindowController('C:\\app\\main', createCredentialStore())
    controller.show()

    const callback = vi.fn()
    harness.webContents.emit('select-bluetooth-device', { preventDefault: vi.fn() }, [{
      deviceId: 'device-1',
      deviceName: 'Desk display',
    }], callback)
    await ipcHandler(desktopProvisioningChannels.selectDevice)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      'device-1',
    )
    harness.window.emit('closed')
    controller.close()

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('device-1')
  })

  it('bounds an empty Bluetooth scan and leaves cancellation idempotent', () => {
    vi.useFakeTimers()
    const harness = createWindowHarness()
    mocks.createWindow.mockReturnValue(harness.window)
    const controller = createSettingsWindowController('C:\\app\\main', createCredentialStore())
    controller.show()

    const callback = vi.fn()
    const event = { preventDefault: vi.fn() }
    harness.webContents.emit('select-bluetooth-device', event, [], callback)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(callback).not.toHaveBeenCalled()
    expect(harness.webContents.send).toHaveBeenCalledWith(
      desktopProvisioningChannels.devicesChanged,
      { devices: [], transport: 'bluetooth' },
    )

    vi.advanceTimersByTime(15_000)
    expect(callback).toHaveBeenCalledWith('')
    expect(vi.getTimerCount()).toBe(0)

    // A later cancellation is idempotent and must not invoke the platform callback again.
    expect(() => ipcHandler(desktopProvisioningChannels.selectDevice)(
      { sender: harness.webContents } as unknown as IpcMainInvokeEvent,
      null,
    )).not.toThrow()
    expect(callback).toHaveBeenCalledTimes(1)
    controller.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})

function createCredentialStore() {
  const tokens = new Map<string, string>()
  return {
    clear: vi.fn(async (deviceId: string) => { tokens.delete(deviceId) }),
    has: vi.fn(async (deviceId: string) => tokens.has(deviceId)),
    load: vi.fn(async (deviceId: string) => tokens.get(deviceId) ?? null),
    save: vi.fn(async (deviceId: string, token: string) => { tokens.set(deviceId, token) }),
  }
}
