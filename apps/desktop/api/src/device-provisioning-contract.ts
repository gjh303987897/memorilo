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

export interface DesktopDeviceGalleryUpload extends DesktopDeviceGalleryTarget {
  readonly bytes: Uint8Array
  readonly createdAtUnixSeconds: number
  readonly name: string
}

export const desktopProvisioningChannels = {
  clearLocalManagementToken: 'memorilo:device-provisioning:clear-local-management-token',
  deleteGalleryAsset: 'memorilo:device-provisioning:delete-gallery-asset',
  devicesChanged: 'memorilo:device-provisioning:devices-changed',
  generateLocalManagementToken: 'memorilo:device-provisioning:generate-local-management-token',
  hasLocalManagementToken: 'memorilo:device-provisioning:has-local-management-token',
  loadGallery: 'memorilo:device-provisioning:load-gallery',
  pairingRequested: 'memorilo:device-provisioning:pairing-requested',
  respondToPairing: 'memorilo:device-provisioning:respond-to-pairing',
  saveLocalManagementToken: 'memorilo:device-provisioning:save-local-management-token',
  setGallerySlideshow: 'memorilo:device-provisioning:set-gallery-slideshow',
  reorderGallery: 'memorilo:device-provisioning:reorder-gallery',
  selectDevice: 'memorilo:device-provisioning:select-device',
  uploadGalleryAsset: 'memorilo:device-provisioning:upload-gallery-asset',
} as const
