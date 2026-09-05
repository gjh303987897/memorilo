export interface DesktopProvisioningDevice {
  readonly deviceId: string
  readonly deviceName: string
}

export interface DesktopProvisioningPairingRequest {
  readonly deviceId: string
  readonly pairingKind: 'confirm' | 'confirmPin' | 'providePin'
  readonly pin?: string
  readonly requestId: string
}

export interface DesktopProvisioningPairingResponse {
  readonly confirmed: boolean
  readonly pin?: string
  readonly requestId: string
}

export interface DesktopDeviceGalleryAsset {
  readonly byteLength: number
  readonly checksum: number
  readonly createdAtUnixSeconds: number
  readonly id: number
  readonly name: string
}

export interface DesktopDeviceGalleryStatus {
  readonly capacityBytes: number
  readonly catalog: {
    readonly assets: readonly DesktopDeviceGalleryAsset[]
    readonly slideshowIntervalSeconds: number | null
  }
  readonly fullRefreshSeconds: number
  readonly imageBytes: number
  readonly lastError: string | null
  readonly maxAssets: number
  readonly mutationRevision: number
}

export interface DesktopDeviceGalleryTarget {
  readonly address: string
  readonly deviceId: string
}

export type DesktopDeviceNetworkPhase = 'authentication-failed' | 'backoff' | 'connecting' | 'disabled' | 'idle' | 'online'

export interface DesktopDeviceStatus {
  readonly firmwareVersion: string
  readonly network: {
    readonly consecutiveFailures: number
    readonly ipv4: string | null
    readonly mqttConnected: boolean
    readonly phase: DesktopDeviceNetworkPhase
    readonly retryAtMs: number | null
    readonly timeSynchronized: boolean
  }
  readonly uptimeMs: number
}

export interface DesktopDeviceGalleryUpload extends DesktopDeviceGalleryTarget {
  readonly bytes: Uint8Array
  readonly createdAtUnixSeconds: number
  readonly name: string
}

export type DesktopDeviceTodoStatusValue = 'todo' | 'in-progress' | 'done'

export interface DesktopDeviceTodoItem {
  readonly allDay: boolean
  readonly dueDate: string | null
  readonly dueTime: string | null
  readonly id: string
  readonly noteTitle: string
  readonly parentId: string | null
  readonly revision: string
  readonly status: DesktopDeviceTodoStatusValue
  readonly text: string
  readonly topicTitle: string
}

export interface DesktopDeviceTodoSnapshot {
  readonly generatedAt: string
  readonly items: readonly DesktopDeviceTodoItem[]
  readonly revision: string
}

export interface DesktopDeviceTodoState {
  readonly lastError: string | null
  readonly lastEvent?: 'updated' | 'empty' | 'notification' | 'not-modified' | 'authentication-failure' | 'retrying' | 'offline-cache' | null
  readonly lastSuccessUnixSeconds: number | null
  readonly revision: string | null
  readonly snapshot: DesktopDeviceTodoSnapshot | null
  readonly source: 'client-lan-push' | 'mqtt-triggered-https' | 'periodic-https' | null
}

export interface DesktopDeviceTodoPush extends DesktopDeviceGalleryTarget {
  readonly snapshot: DesktopDeviceTodoSnapshot
}

export interface DesktopDeviceTodoPushStatus {
  readonly address: string
  readonly deviceId: string
  readonly phase: 'idle' | 'pending' | 'success' | 'error'
  readonly revision: string | null
  readonly lastError: string | null
}

export interface DesktopDeviceTodoTargetState {
  readonly target: DesktopDeviceGalleryTarget | null
  readonly status: DesktopDeviceTodoPushStatus | null
}

export const desktopProvisioningChannels = {
  clearLocalManagementToken: 'memorilo:device-provisioning:clear-local-management-token',
  deleteGalleryAsset: 'memorilo:device-provisioning:delete-gallery-asset',
  devicesChanged: 'memorilo:device-provisioning:devices-changed',
  generateLocalManagementToken: 'memorilo:device-provisioning:generate-local-management-token',
  hasLocalManagementToken: 'memorilo:device-provisioning:has-local-management-token',
  loadGallery: 'memorilo:device-provisioning:load-gallery',
  loadStatus: 'memorilo:device-provisioning:load-status',
  loadTodos: 'memorilo:device-provisioning:load-todos',
  loadTodoTarget: 'memorilo:device-provisioning:load-todo-target',
  pairingRequested: 'memorilo:device-provisioning:pairing-requested',
  respondToPairing: 'memorilo:device-provisioning:respond-to-pairing',
  saveLocalManagementToken: 'memorilo:device-provisioning:save-local-management-token',
  setGallerySlideshow: 'memorilo:device-provisioning:set-gallery-slideshow',
  reorderGallery: 'memorilo:device-provisioning:reorder-gallery',
  selectDevice: 'memorilo:device-provisioning:select-device',
  uploadGalleryAsset: 'memorilo:device-provisioning:upload-gallery-asset',
  pushTodos: 'memorilo:device-provisioning:push-todos',
  refreshDevice: 'memorilo:device-provisioning:refresh-device',
  nextDevicePage: 'memorilo:device-provisioning:next-device-page',
  sleepDevice: 'memorilo:device-provisioning:sleep-device',
  saveTodoTarget: 'memorilo:device-provisioning:save-todo-target',
} as const
