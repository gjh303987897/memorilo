import type { DeviceProvisioningClient } from './device-provisioning-service'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DeviceGallery } from './device-gallery'
import { DeviceProvisioningError } from './device-provisioning-service'

describe('deviceGallery', () => {
  it('loads bounded metadata through main without exposing a token field', async () => {
    const loadGallery = vi.fn(() => Effect.succeed({
      capacityBytes: 4_194_304,
      catalog: {
        assets: [{
          byteLength: 30_000,
          checksum: 1,
          createdAtUnixSeconds: 1,
          id: 1,
          name: '四色照片',
        }],
        slideshowIntervalSeconds: null,
      },
      fullRefreshSeconds: 20,
      imageBytes: 30_000,
      lastError: null,
      maxAssets: 100,
      mutationRevision: 1,
    }))
    const rendered = render(
      <DeviceGallery client={client({ loadGallery })} deviceId="device-1" enabled />,
    )

    fireEvent.change(rendered.getByRole('textbox', { name: 'Device LAN address' }), {
      target: { value: '192.168.4.23' },
    })
    fireEvent.click(rendered.getByRole('button', { name: 'Load gallery' }))

    await waitFor(() => expect(rendered.getByText('四色照片')).toBeInTheDocument())
    expect(loadGallery).toHaveBeenCalledWith({ address: '192.168.4.23', deviceId: 'device-1' })
    expect(rendered.queryByLabelText(/token/iu)).not.toBeInTheDocument()
    expect(rendered.getByText('About 20 seconds per full refresh')).toBeInTheDocument()
  })

  it('keeps local management unavailable until the encrypted credential exists', () => {
    const rendered = render(
      <DeviceGallery client={client()} deviceId="device-1" enabled={false} />,
    )
    expect(rendered.getByRole('button', { name: 'Load gallery' })).toBeDisabled()
    expect(rendered.getByRole('status')).toHaveTextContent('securely store a local management token')
  })
})

function client(overrides: Partial<DeviceProvisioningClient> = {}): DeviceProvisioningClient {
  const unused = () => Effect.fail(new DeviceProvisioningError({ code: 'local-management' }))
  return {
    cancelSelection: () => Effect.void,
    clearLocalManagementToken: () => Effect.void,
    connect: unused,
    deleteGalleryAsset: () => Effect.void,
    generateLocalManagementToken: () => Effect.succeed('a'.repeat(32)),
    hasLocalManagementToken: () => Effect.succeed(true),
    loadGallery: unused,
    loadStatus: unused,
    loadTodos: unused,
    loadTodoTarget: () => Effect.succeed({ status: null, target: null }),
    pushTodos: () => Effect.void,
    refreshDevice: () => Effect.void,
    nextDevicePage: () => Effect.void,
    sleepDevice: () => Effect.void,
    reorderGallery: () => Effect.void,
    respondToPairing: () => Effect.void,
    saveLocalManagementToken: () => Effect.void,
    saveTodoTarget: () => Effect.void,
    selectDevice: () => Effect.void,
    setGallerySlideshow: () => Effect.void,
    subscribeDevices: () => vi.fn(),
    subscribePairing: () => vi.fn(),
    uploadGalleryAsset: () => Effect.void,
    ...overrides,
  }
}
