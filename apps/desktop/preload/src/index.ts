import type { DesktopApi, DesktopConfiguration, DesktopNoteExternalUpdate, DesktopProvisioningDevice, DesktopProvisioningPairingRequest, DesktopSyncServerEvent } from './contract'
import type { NoteSaveRequest } from './note-save-handshake'
import { desktopProvisioningChannels, desktopSyncServerEventChannel } from '@memorilo/desktop-api'
import { desktopConfigurationChangedChannel } from '@memorilo/desktop-config/contract'
import { Match } from 'effect'
import { contextBridge, ipcRenderer } from 'electron'

import { createDesktopApi } from './desktop-api'
import { createDesktopIpcClient } from './ipc-client'
import { createNoteSaveCoordinator } from './note-save-coordinator'
import { noteSaveRequestChannel, noteSaveResultChannel } from './note-save-handshake'

const p2pStatusChannel = 'memorilo:p2p-status'
const learningUpdateChannel = 'memorilo:learning-update'

const services = createDesktopIpcClient(ipcRenderer)

const deviceProvisioning: DesktopApi['deviceProvisioning'] = {
  cancelSelection: () => ipcRenderer.invoke(desktopProvisioningChannels.selectDevice, null),
  clearLocalManagementToken: deviceId => ipcRenderer.invoke(desktopProvisioningChannels.clearLocalManagementToken, deviceId),
  deleteGalleryAsset: (target, id) => ipcRenderer.invoke(
    desktopProvisioningChannels.deleteGalleryAsset,
    { ...target, id },
  ),
  generateLocalManagementToken: () => ipcRenderer.invoke(desktopProvisioningChannels.generateLocalManagementToken),
  hasLocalManagementToken: deviceId => ipcRenderer.invoke(desktopProvisioningChannels.hasLocalManagementToken, deviceId),
  loadGallery: target => ipcRenderer.invoke(desktopProvisioningChannels.loadGallery, target),
  reorderGallery: (target, order) => ipcRenderer.invoke(
    desktopProvisioningChannels.reorderGallery,
    { ...target, order },
  ),
  respondToPairing: response => ipcRenderer.invoke(desktopProvisioningChannels.respondToPairing, response),
  saveLocalManagementToken: (deviceId, token) => ipcRenderer.invoke(
    desktopProvisioningChannels.saveLocalManagementToken,
    { deviceId, token },
  ),
  setGallerySlideshow: (target, intervalSeconds) => ipcRenderer.invoke(
    desktopProvisioningChannels.setGallerySlideshow,
    { ...target, intervalSeconds },
  ),
  selectDevice: deviceId => ipcRenderer.invoke(desktopProvisioningChannels.selectDevice, deviceId),
  subscribeDevices: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, devices: readonly DesktopProvisioningDevice[]) => listener(devices)
    ipcRenderer.on(desktopProvisioningChannels.devicesChanged, handle)
    return () => ipcRenderer.removeListener(desktopProvisioningChannels.devicesChanged, handle)
  },
  subscribePairing: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, request: DesktopProvisioningPairingRequest) => listener(request)
    ipcRenderer.on(desktopProvisioningChannels.pairingRequested, handle)
    return () => ipcRenderer.removeListener(desktopProvisioningChannels.pairingRequested, handle)
  },
  uploadGalleryAsset: input => ipcRenderer.invoke(
    desktopProvisioningChannels.uploadGalleryAsset,
    input,
  ),
}

function subscribeConfiguration(listener: (configuration: DesktopConfiguration) => void): () => void {
  const handleChange = (_event: Electron.IpcRendererEvent, configuration: DesktopConfiguration) => {
    listener(configuration)
  }
  ipcRenderer.on(desktopConfigurationChangedChannel, handleChange)
  return () => ipcRenderer.removeListener(desktopConfigurationChangedChannel, handleChange)
}

const noteSaveCoordinator = createNoteSaveCoordinator(result => ipcRenderer.send(noteSaveResultChannel, result))
// Sandboxed preloads expose process.platform but cannot require node:process.
// eslint-disable-next-line node/prefer-global/process
const nativePlatform = process.platform
const platform = Match.value(nativePlatform).pipe(
  Match.when('darwin', () => 'macos' as const),
  Match.when('win32', () => 'windows' as const),
  Match.when('linux', () => 'linux' as const),
  Match.orElse(() => 'other' as const),
)
ipcRenderer.on(noteSaveRequestChannel, async (_event, request: NoteSaveRequest) => {
  await noteSaveCoordinator.handle(request.requestId)
})
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void noteSaveCoordinator.close().catch(error => console.error(
      'Failed to close the renderer Note save coordinator',
      error,
    ))
  }, { once: true })
}

function subscribeNoteSaveRequests(listener: Parameters<DesktopApi['subscribeNoteSaveRequests']>[0]): () => void {
  return noteSaveCoordinator.subscribe(listener)
}

function subscribeNoteUpdates(listener: Parameters<DesktopApi['subscribeNoteUpdates']>[0]): () => void {
  const handleUpdate = (_event: Electron.IpcRendererEvent, update: DesktopNoteExternalUpdate) => {
    listener(update)
  }
  ipcRenderer.on('memorilo:note-update', handleUpdate)
  return () => ipcRenderer.removeListener('memorilo:note-update', handleUpdate)
}

function subscribeLearningUpdates(listener: Parameters<DesktopApi['subscribeLearningUpdates']>[0]): () => void {
  const handleUpdate = () => listener()
  ipcRenderer.on(learningUpdateChannel, handleUpdate)
  return () => ipcRenderer.removeListener(learningUpdateChannel, handleUpdate)
}

function subscribeP2pStatus(listener: Parameters<DesktopApi['subscribeP2pStatus']>[0]): () => void {
  const handleStatus = (_event: Electron.IpcRendererEvent, status: Parameters<DesktopApi['subscribeP2pStatus']>[0] extends (status: infer Status) => void ? Status : never) => listener(status)
  ipcRenderer.on(p2pStatusChannel, handleStatus)
  return () => ipcRenderer.removeListener(p2pStatusChannel, handleStatus)
}

function subscribeSyncServerEvents(listener: Parameters<DesktopApi['subscribeSyncServerEvents']>[0]): () => void {
  const handleEvent = (_event: Electron.IpcRendererEvent, event: DesktopSyncServerEvent) => listener(event)
  ipcRenderer.on(desktopSyncServerEventChannel, handleEvent)
  return () => ipcRenderer.removeListener(desktopSyncServerEventChannel, handleEvent)
}

contextBridge.exposeInMainWorld(
  'desktop',
  createDesktopApi(
    platform,
    services,
    subscribeConfiguration,
    subscribeNoteSaveRequests,
    subscribeNoteUpdates,
    subscribeP2pStatus,
    subscribeLearningUpdates,
    subscribeSyncServerEvents,
    deviceProvisioning,
  ),
)
