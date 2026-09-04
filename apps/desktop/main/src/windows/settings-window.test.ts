import type { IpcMainInvokeEvent } from 'electron'
import { EventEmitter } from 'node:events'
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
  session: {
    setBluetoothPairingHandler: ReturnType<typeof vi.fn>
  }
  webContents: EventEmitter & {
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
  const session = {
    setBluetoothPairingHandler: vi.fn((handler) => {
      harness.pairingHandler = handler
    }),
  }
  const webContents = Object.assign(new EventEmitter(), {
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
  mocks.createWindow.mockReset()
  mocks.ipcHandle.mockReset()
  mocks.ipcRemoveHandler.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('settings window Bluetooth provisioning', () => {
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
      [],
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
