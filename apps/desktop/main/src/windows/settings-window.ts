import type {
  DesktopDeviceGalleryTarget,
  DesktopDeviceGalleryUpload,
  DesktopDeviceTodoPush,
  DesktopProvisioningPairingResponse,
} from '@memorilo/desktop-api'
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent } from 'electron'
import type { LocalManagementCredentialStore } from '../storage/electron-local-management-credential-store'
import type { TodoDevicePushService } from '../todo/todo-device-push-service'
import type { TodoDeviceTargetStore } from '../todo/todo-device-target-store'
import { join } from 'node:path'
import process from 'node:process'
import { desktopProvisioningChannels } from '@memorilo/desktop-api'
import { Effect } from 'effect'
import { BrowserWindow, ipcMain } from 'electron'
import { DeviceLocalManagementClient } from '../device-local-management-client'
import {
  assertLocalManagementToken,
  generateLocalManagementToken,
} from '../storage/electron-local-management-credential-store'

export interface SettingsWindowController {
  close: () => void
  show: () => void
}

const bluetoothSelectionTimeoutMilliseconds = 15_000

export function createSettingsWindowController(
  mainDirectory: string,
  localManagementCredentials: LocalManagementCredentialStore,
  todoDeviceTargets?: TodoDeviceTargetStore,
  todoDevicePush?: TodoDevicePushService,
): SettingsWindowController {
  let settingsWindow: BrowserWindow | null = null
  let pendingSelection: {
    callback: (deviceId: string) => void
    devices: ReadonlyMap<string, Electron.BluetoothDevice>
    timer: ReturnType<typeof setTimeout>
  } | null = null
  let pendingPairing: {
    callback: (response: Electron.Response) => void
    requestId: string
    pairingKind: Electron.BluetoothPairingHandlerHandlerDetails['pairingKind']
  } | null = null
  let pairingRequestSequence = 0
  const localManagement = new DeviceLocalManagementClient(localManagementCredentials)
  const shouldShowWindow = process.env.MEMORILO_E2E_HIDE_WINDOW !== '1'

  const requireSettingsSender = (event: IpcMainInvokeEvent): BrowserWindow => {
    const current = settingsWindow
    if (!current || current.isDestroyed() || event.sender !== current.webContents)
      throw new Error('Device provisioning is only available from the settings window')
    return current
  }

  ipcMain.handle(desktopProvisioningChannels.selectDevice, (event, deviceId: unknown) => {
    requireSettingsSender(event)
    const pending = pendingSelection
    if (!pending && deviceId === null)
      return
    if (!pending)
      throw new Error('No Bluetooth device selection is active')
    if (deviceId !== null && (typeof deviceId !== 'string' || !pending.devices.has(deviceId)))
      throw new TypeError('Selected Bluetooth device is not available')
    pendingSelection = null
    clearTimeout(pending.timer)
    pending.callback(deviceId ?? '')
  })
  ipcMain.handle(desktopProvisioningChannels.respondToPairing, (event, response: unknown) => {
    requireSettingsSender(event)
    const pending = pendingPairing
    if (!pending)
      throw new Error('No Bluetooth pairing response is pending')
    if (!isPairingResponse(response) || response.requestId !== pending.requestId)
      throw new TypeError('Bluetooth pairing response does not match the active request')
    if (response.confirmed
      && pending.pairingKind === 'providePin'
      && !/^\d{6}$/u.test(response.pin ?? '')) {
      throw new TypeError('Bluetooth pairing PIN must contain exactly six digits')
    }
    pendingPairing = null
    pending.callback({
      confirmed: response.confirmed,
      pin: pending.pairingKind === 'providePin' ? response.pin : undefined,
    })
  })
  ipcMain.handle(desktopProvisioningChannels.generateLocalManagementToken, (event) => {
    requireSettingsSender(event)
    return generateLocalManagementToken()
  })
  ipcMain.handle(desktopProvisioningChannels.hasLocalManagementToken, async (event, deviceId: unknown) => {
    requireSettingsSender(event)
    return localManagementCredentials.has(requireDeviceId(deviceId))
  })
  ipcMain.handle(desktopProvisioningChannels.saveLocalManagementToken, async (event, input: unknown) => {
    requireSettingsSender(event)
    if (!isLocalManagementCredential(input))
      throw new TypeError('Invalid local management credential')
    assertLocalManagementToken(input.token)
    await localManagementCredentials.save(input.deviceId, input.token)
  })
  ipcMain.handle(desktopProvisioningChannels.clearLocalManagementToken, async (event, deviceId: unknown) => {
    requireSettingsSender(event)
    await localManagementCredentials.clear(requireDeviceId(deviceId))
  })
  ipcMain.handle(desktopProvisioningChannels.loadGallery, async (event, input: unknown) => {
    requireSettingsSender(event)
    return Effect.runPromise(localManagement.loadGallery(requireGalleryTarget(input)))
  })
  ipcMain.handle(desktopProvisioningChannels.loadTodos, async (event, input: unknown) => {
    requireSettingsSender(event)
    return Effect.runPromise(localManagement.loadTodos(requireGalleryTarget(input)))
  })
  ipcMain.handle(desktopProvisioningChannels.pushTodos, async (event, input: unknown) => {
    requireSettingsSender(event)
    return Effect.runPromise(localManagement.pushTodos(requireTodoPush(input)))
  })
  ipcMain.handle(desktopProvisioningChannels.loadTodoTarget, async (event, deviceId: unknown) => {
    requireSettingsSender(event)
    const id = requireDeviceId(deviceId)
    const targets = todoDeviceTargets ? await todoDeviceTargets.load() : []
    return {
      status: todoDevicePush?.statuses().find(status => status.deviceId === id) ?? null,
      target: targets.find(target => target.deviceId === id) ?? null,
    }
  })
  ipcMain.handle(desktopProvisioningChannels.saveTodoTarget, async (event, input: unknown) => {
    requireSettingsSender(event)
    if (!todoDeviceTargets || !todoDevicePush)
      throw new Error('TODO device target storage is unavailable')
    if (!isRecord(input) || typeof input.deviceId !== 'string' || !isOptionalAddress(input.address))
      throw new TypeError('Invalid TODO device target')
    const deviceId = requireDeviceId(input.deviceId)
    const targets = input.address === null || input.address.trim().length === 0
      ? await todoDeviceTargets.remove(deviceId)
      : await todoDeviceTargets.replace({ address: input.address, deviceId })
    todoDevicePush.setTargets(targets)
  })
  ipcMain.handle(desktopProvisioningChannels.uploadGalleryAsset, async (event, input: unknown) => {
    requireSettingsSender(event)
    return Effect.runPromise(localManagement.uploadAsset(requireGalleryUpload(input)))
  })
  ipcMain.handle(desktopProvisioningChannels.deleteGalleryAsset, async (event, input: unknown) => {
    requireSettingsSender(event)
    const target = requireGalleryTarget(input)
    if (!isRecord(input) || typeof input.id !== 'number')
      throw new TypeError('Invalid gallery asset deletion')
    return Effect.runPromise(localManagement.deleteAsset(target, input.id))
  })
  ipcMain.handle(desktopProvisioningChannels.reorderGallery, async (event, input: unknown) => {
    requireSettingsSender(event)
    const target = requireGalleryTarget(input)
    if (!isRecord(input) || !Array.isArray(input.order) || input.order.some(id => typeof id !== 'number'))
      throw new TypeError('Invalid gallery order')
    return Effect.runPromise(localManagement.reorder(target, input.order))
  })
  ipcMain.handle(desktopProvisioningChannels.setGallerySlideshow, async (event, input: unknown) => {
    requireSettingsSender(event)
    const target = requireGalleryTarget(input)
    if (!isRecord(input) || (input.intervalSeconds !== null && typeof input.intervalSeconds !== 'number'))
      throw new TypeError('Invalid gallery slideshow interval')
    return Effect.runPromise(localManagement.setSlideshow(target, input.intervalSeconds))
  })

  const cancelPendingBluetooth = (): void => {
    if (pendingSelection) {
      clearTimeout(pendingSelection.timer)
      pendingSelection.callback('')
    }
    pendingSelection = null
    pendingPairing?.callback({ confirmed: false })
    pendingPairing = null
  }

  const show = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (settingsWindow.isMinimized())
        settingsWindow.restore()
      if (shouldShowWindow) {
        settingsWindow.show()
        settingsWindow.focus()
      }
      return
    }

    const macOSOptions: BrowserWindowConstructorOptions = process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 20, y: 20 },
        }
      : {}
    settingsWindow = new BrowserWindow({
      autoHideMenuBar: process.platform !== 'darwin',
      backgroundColor: '#ffffff',
      fullscreenable: false,
      height: 560,
      maximizable: false,
      minimizable: false,
      minHeight: 480,
      minWidth: 680,
      resizable: true,
      show: false,
      title: 'Memorilo Settings',
      width: 780,
      ...macOSOptions,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(mainDirectory, '../preload/index.cjs'),
        sandbox: true,
      },
    })

    settingsWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
      event.preventDefault()
      const current = settingsWindow
      if (!current || current.isDestroyed()) {
        callback('')
        return
      }
      const availableDevices = new Map(devices.map(device => [device.deviceId, device]))
      if (pendingSelection) {
        // Electron emits repeated list updates for one request. Keep one
        // bounded chooser task and replace its latest callback and snapshot.
        pendingSelection.callback = callback
        pendingSelection.devices = availableDevices
      }
      else {
        const selection = {
          callback,
          devices: availableDevices,
          timer: setTimeout(() => {
            if (pendingSelection !== selection)
              return
            pendingSelection = null
            selection.callback('')
          }, bluetoothSelectionTimeoutMilliseconds),
        }
        pendingSelection = selection
      }
      current.webContents.send(
        desktopProvisioningChannels.devicesChanged,
        devices.map(device => ({ deviceId: device.deviceId, deviceName: device.deviceName })),
      )
    })
    if (process.platform !== 'darwin') {
      settingsWindow.webContents.session.setBluetoothPairingHandler((details, callback) => {
        const current = settingsWindow
        if (!current || current.isDestroyed() || details.frame?.top !== current.webContents.mainFrame) {
          callback({ confirmed: false })
          return
        }
        pendingPairing?.callback({ confirmed: false })
        pairingRequestSequence += 1
        const requestId = `bluetooth-pairing-${pairingRequestSequence}`
        pendingPairing = { callback, pairingKind: details.pairingKind, requestId }
        current.webContents.send(desktopProvisioningChannels.pairingRequested, {
          deviceId: details.deviceId,
          pairingKind: details.pairingKind,
          pin: details.pin,
          requestId,
        })
      })
    }

    if (shouldShowWindow)
      settingsWindow.once('ready-to-show', () => settingsWindow?.show())
    settingsWindow.on('closed', () => {
      cancelPendingBluetooth()
      settingsWindow?.webContents.session.setBluetoothPairingHandler(null)
      settingsWindow = null
    })
    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl) {
      const baseUrl = rendererUrl.endsWith('/') ? rendererUrl : `${rendererUrl}/`
      void settingsWindow.loadURL(new URL('settings.html', baseUrl).toString())
    }
    else {
      void settingsWindow.loadFile(join(mainDirectory, '../renderer/settings.html'))
    }
  }

  const close = (): void => {
    const current = settingsWindow
    settingsWindow = null
    cancelPendingBluetooth()
    current?.webContents.session.setBluetoothPairingHandler(null)
    if (current && !current.isDestroyed())
      current.destroy()
    ipcMain.removeHandler(desktopProvisioningChannels.selectDevice)
    ipcMain.removeHandler(desktopProvisioningChannels.respondToPairing)
    ipcMain.removeHandler(desktopProvisioningChannels.generateLocalManagementToken)
    ipcMain.removeHandler(desktopProvisioningChannels.hasLocalManagementToken)
    ipcMain.removeHandler(desktopProvisioningChannels.saveLocalManagementToken)
    ipcMain.removeHandler(desktopProvisioningChannels.clearLocalManagementToken)
    ipcMain.removeHandler(desktopProvisioningChannels.loadGallery)
    ipcMain.removeHandler(desktopProvisioningChannels.loadTodos)
    ipcMain.removeHandler(desktopProvisioningChannels.pushTodos)
    ipcMain.removeHandler(desktopProvisioningChannels.loadTodoTarget)
    ipcMain.removeHandler(desktopProvisioningChannels.saveTodoTarget)
    ipcMain.removeHandler(desktopProvisioningChannels.uploadGalleryAsset)
    ipcMain.removeHandler(desktopProvisioningChannels.deleteGalleryAsset)
    ipcMain.removeHandler(desktopProvisioningChannels.reorderGallery)
    ipcMain.removeHandler(desktopProvisioningChannels.setGallerySlideshow)
  }

  return { close, show }
}

function requireGalleryTarget(value: unknown): DesktopDeviceGalleryTarget {
  if (!isRecord(value)
    || typeof value.address !== 'string'
    || typeof value.deviceId !== 'string') {
    throw new TypeError('Invalid gallery target')
  }
  return { address: value.address, deviceId: value.deviceId }
}

function requireGalleryUpload(value: unknown): DesktopDeviceGalleryUpload {
  const target = requireGalleryTarget(value)
  if (!isRecord(value)
    || !(value.bytes instanceof Uint8Array)
    || typeof value.createdAtUnixSeconds !== 'number'
    || typeof value.name !== 'string') {
    throw new TypeError('Invalid gallery upload')
  }
  return {
    ...target,
    bytes: value.bytes,
    createdAtUnixSeconds: value.createdAtUnixSeconds,
    name: value.name,
  }
}

function requireTodoPush(value: unknown): DesktopDeviceTodoPush {
  const target = requireGalleryTarget(value)
  if (!isRecord(value) || !isRecord(value.snapshot))
    throw new TypeError('Invalid TODO snapshot push')
  return { ...target, snapshot: value.snapshot as unknown as DesktopDeviceTodoPush['snapshot'] }
}

function isOptionalAddress(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLocalManagementCredential(value: unknown): value is { deviceId: string, token: string } {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { deviceId?: unknown }).deviceId === 'string'
    && typeof (value as { token?: unknown }).token === 'string'
    && (value as { deviceId: string }).deviceId.length > 0
    && (value as { deviceId: string }).deviceId.length <= 256
}

function requireDeviceId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw new TypeError('Invalid device ID')
  return value
}

function isPairingResponse(value: unknown): value is DesktopProvisioningPairingResponse {
  return typeof value === 'object'
    && value !== null
    && typeof (value as DesktopProvisioningPairingResponse).requestId === 'string'
    && typeof (value as DesktopProvisioningPairingResponse).confirmed === 'boolean'
    && ((value as DesktopProvisioningPairingResponse).pin === undefined
      || typeof (value as DesktopProvisioningPairingResponse).pin === 'string')
}
