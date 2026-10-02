import type { DeviceProvisioningClient, DeviceProvisioningSession } from './device-provisioning-service'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { Effect } from 'effect'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DeviceGallery, DeviceGalleryErrorBoundary, DeviceImageCropEditor, GalleryUploadProgressBar } from './device-gallery'
import { defaultDeviceImageCrop } from './device-image-conversion'
import { DeviceProvisioningError } from './device-provisioning-service'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deviceGallery', () => {
  it('loads the gallery automatically when an active connection is available', async () => {
    const loadGallery = vi.fn(() => Effect.succeed(emptyGallery()))
    const rendered = render(
      <DeviceGallery
        client={client({ loadGallery })}
        deviceId="device-1"
        enabled
        session={session({ loadGallery })}
      />,
    )

    await waitFor(() => expect(rendered.getByRole('status')).toHaveTextContent('Gallery loaded from the device.'))
    expect(loadGallery).toHaveBeenCalledOnce()
  })

  it('isolates a gallery render failure from the rest of Settings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const BrokenGallery = () => {
      throw new Error('broken gallery preview')
    }
    const rendered = render(
      <main>
        <h1>Settings</h1>
        <DeviceGalleryErrorBoundary fallback="Gallery failed" retry="Reset gallery">
          <BrokenGallery />
        </DeviceGalleryErrorBoundary>
      </main>,
    )

    expect(rendered.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(rendered.getByRole('alert')).toHaveTextContent('Gallery failed')
    expect(rendered.getByRole('button', { name: 'Reset gallery' })).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('keeps the settings surface mounted after selecting a real image in StrictMode', async () => {
    const runtimeErrors: unknown[] = []
    const onError = (event: ErrorEvent) => runtimeErrors.push(event.error ?? event.message)
    const onUnhandledRejection = (event: PromiseRejectionEvent) => runtimeErrors.push(event.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    const source = document.createElement('canvas')
    source.width = 800
    source.height = 400
    source.getContext('2d')?.fillRect(0, 0, source.width, source.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      source.toBlob(value => value ? resolve(value) : reject(new Error('PNG fixture creation failed')), 'image/png')
    })
    const rendered = render(
      <StrictMode>
        <DeviceGallery
          client={client()}
          deviceId="device-1"
          enabled
          session={session({ loadGallery: () => Effect.succeed(emptyGallery()) })}
        />
      </StrictMode>,
    )

    try {
      await waitFor(() => expect(rendered.getByRole('status')).toHaveTextContent('Gallery loaded from the device.'))
      fireEvent.change(rendered.getByLabelText('Choose image'), {
        target: { files: [new File([blob], 'frame.png', { type: 'image/png' })] },
      })

      await waitFor(() => expect(rendered.getByRole('application', { name: 'Crop image' })).toBeInTheDocument())
      await waitFor(() => expect(rendered.getByRole('button', { name: 'Upload image' })).toBeEnabled())
      expect(rendered.getByRole('heading', { name: 'Device gallery' })).toBeInTheDocument()
      expect(runtimeErrors).toEqual([])
    }
    finally {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  })

  it('lets the user drag the selected crop region and zoom the source image', () => {
    const onChange = vi.fn()
    const source = document.createElement('canvas')
    source.width = 800
    source.height = 400
    const rendered = render(
      <DeviceImageCropEditor
        crop={defaultDeviceImageCrop}
        source={source}
        sourceHeight={400}
        sourceWidth={800}
        onChange={onChange}
      />,
    )
    const cropArea = rendered.getByRole('application', { name: 'Crop image' })
    Object.defineProperty(cropArea, 'setPointerCapture', { configurable: true, value: vi.fn() })

    fireEvent.change(rendered.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } })
    fireEvent.pointerDown(cropArea, { clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(cropArea, { clientX: 240, clientY: 100, pointerId: 1 })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ focusX: expect.any(Number) }))
    const draggedFocusX = onChange.mock.lastCall?.[0].focusX as number
    expect(draggedFocusX).toBeLessThan(0.5)

    fireEvent.change(rendered.getByRole('slider', { name: 'Zoom' }), { target: { value: '3' } })
    expect(onChange).toHaveBeenLastCalledWith({ focusX: draggedFocusX, focusY: 0.5, zoom: 3 })
  })

  it('renders determinate byte progress and an honest indeterminate commit stage', () => {
    const rendered = render(<GalleryUploadProgressBar progress={{ phase: 'sending', sentBytes: 15, totalBytes: 30 }} />)
    expect(rendered.getByRole('progressbar', { name: 'Uploading image' })).toHaveAttribute('aria-valuenow', '15')
    expect(rendered.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '30')

    rendered.rerender(<GalleryUploadProgressBar progress={{ phase: 'committing', sentBytes: 30, totalBytes: 30 }} />)
    expect(rendered.getByRole('progressbar', { name: 'Saving image on device' })).not.toHaveAttribute('aria-valuenow')
  })

  it('shows live transport progress during an upload', async () => {
    const source = document.createElement('canvas')
    source.width = 800
    source.height = 400
    source.getContext('2d')?.fillRect(0, 0, source.width, source.height)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Object.assign(source, { close: vi.fn() })))
    let reportProgress: ((progress: { sentBytes: number, totalBytes: number }) => void) | undefined
    const uploadGalleryAsset: DeviceProvisioningSession['uploadGalleryAsset'] = (_bytes, _name, _createdAt, onProgress) => {
      reportProgress = onProgress
      return Effect.never
    }
    const loadGallery = vi.fn(() => Effect.succeed(emptyGallery()))
    const rendered = render(
      <DeviceGallery
        client={client()}
        deviceId="device-1"
        enabled
        session={session({ loadGallery, uploadGalleryAsset })}
      />,
    )

    fireEvent.click(rendered.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(rendered.getByRole('status')).toHaveTextContent('Gallery loaded from the device.'))
    fireEvent.change(rendered.getByLabelText('Choose image'), {
      target: { files: [new File(['image'], 'frame.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(rendered.getByRole('button', { name: 'Upload image' })).toBeEnabled())
    expect(createImageBitmap).toHaveBeenCalledOnce()
    fireEvent.click(rendered.getByRole('button', { name: 'Upload image' }))

    await waitFor(() => expect(reportProgress).toBeTypeOf('function'))
    act(() => reportProgress?.({ sentBytes: 5, totalBytes: 10 }))
    await waitFor(() => expect(rendered.getByRole('progressbar', { name: 'Uploading image' })).toHaveAttribute('aria-valuenow', '5'))
    expect(rendered.getByRole('button', { name: 'Uploading and committing image…' })).toBeDisabled()
    rendered.unmount()
  })

  it('does not report a false failure when the device keeps the same mutation revision', async () => {
    const source = document.createElement('canvas')
    source.width = 800
    source.height = 400
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Object.assign(source, { close: vi.fn() })))
    const loadGallery = vi.fn(() => Effect.succeed(emptyGallery()))
    const rendered = render(
      <DeviceGallery
        client={client()}
        deviceId="device-1"
        enabled
        session={session({
          loadGallery,
          uploadGalleryAsset: () => Effect.void,
        })}
      />,
    )

    fireEvent.click(rendered.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(rendered.getByRole('status')).toHaveTextContent('Gallery loaded from the device.'))
    fireEvent.change(rendered.getByLabelText('Choose image'), {
      target: { files: [new File(['image'], 'frame.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(rendered.getByRole('button', { name: 'Upload image' })).toBeEnabled())

    fireEvent.click(rendered.getByRole('button', { name: 'Upload image' }))
    await waitFor(() => expect(rendered.getByRole('status')).toHaveTextContent('Gallery updated.'))
    expect(loadGallery.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('surfaces a capacity rejection instead of the generic gallery error', async () => {
    const source = document.createElement('canvas')
    source.width = 800
    source.height = 400
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Object.assign(source, { close: vi.fn() })))
    const rendered = render(
      <DeviceGallery
        client={client()}
        deviceId="device-1"
        enabled
        session={session({
          loadGallery: () => Effect.succeed(emptyGallery()),
          uploadGalleryAsset: () => Effect.fail(new DeviceProvisioningError({
            cause: 'capacity-exceeded',
            code: 'gallery-unavailable',
          })),
        })}
      />,
    )

    fireEvent.click(rendered.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(rendered.getByRole('status')).toHaveTextContent('Gallery loaded from the device.'))
    fireEvent.change(rendered.getByLabelText('Choose image'), {
      target: { files: [new File(['image'], 'frame.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(rendered.getByRole('button', { name: 'Upload image' })).toBeEnabled())

    fireEvent.click(rendered.getByRole('button', { name: 'Upload image' }))

    await waitFor(() => expect(rendered.getByRole('alert')).toHaveTextContent('The device is out of gallery storage. Delete an image and try again.'))
  })

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

    fireEvent.click(rendered.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(rendered.getByText('四色照片')).toBeInTheDocument())
    expect(rendered.getByRole('status')).toHaveTextContent('Gallery loaded from the device.')
    expect(loadGallery).toHaveBeenCalledWith({ address: 'memorilo-device-1.local', deviceId: 'device-1' })
    expect(rendered.queryByRole('textbox', { name: 'Device LAN address' })).not.toBeInTheDocument()
    expect(rendered.queryByLabelText(/token/iu)).not.toBeInTheDocument()
    expect(rendered.getByText('About 20 seconds per full refresh')).toBeInTheDocument()
    expect(rendered.getByRole('combobox', { name: 'Slideshow' })).toBeDisabled()
    expect(rendered.getByText('Add at least two images to enable slideshow mode.')).toBeInTheDocument()
  })

  it('disables gallery management without an active transport or stored local access', () => {
    const rendered = render(
      <DeviceGallery client={client()} deviceId="device-1" enabled={false} />,
    )
    expect(rendered.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(rendered.getByRole('status')).toHaveTextContent('Connect with Bluetooth or USB, or configure local device access.')
  })

  it('uses the active Bluetooth or USB session instead of requiring local network access', async () => {
    const loadGallery = vi.fn(() => Effect.succeed(emptyGallery()))
    const localLoadGallery = vi.fn(() => Effect.fail(new DeviceProvisioningError({ code: 'local-management' })))
    const rendered = render(
      <DeviceGallery
        client={client({ loadGallery: localLoadGallery })}
        deviceId="device-1"
        enabled
        session={session({ loadGallery })}
      />,
    )

    fireEvent.click(rendered.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(loadGallery).toHaveBeenCalledOnce())
    expect(localLoadGallery).not.toHaveBeenCalled()
    expect(rendered.getByRole('status')).toHaveTextContent('Gallery loaded from the device.')
  })
})

function emptyGallery() {
  return {
    capacityBytes: 4_194_304,
    catalog: { assets: [], slideshowIntervalSeconds: null },
    fullRefreshSeconds: 20,
    imageBytes: 30_000,
    lastError: null,
    maxAssets: 100,
    mutationRevision: 0,
  }
}

function session(overrides: Partial<DeviceProvisioningSession> = {}): DeviceProvisioningSession {
  const unused = () => Effect.fail(new DeviceProvisioningError({ code: 'gallery-unavailable' }))
  return {
    apply: unused,
    close: () => Effect.void,
    connected: true,
    deleteGalleryAsset: unused,
    pushTodos: () => Effect.void,
    device: {
      config: {
        configSchemaVersion: 1,
        deviceName: 'Desk display',
        idleSleepSeconds: 600,
        localManagementTokenIsSet: false,
        protocolVersion: 1,
        revision: 1,
        selectionPolicy: 'Remember',
        timezone: 'UTC',
        todoSyncEnabled: false,
        todoSyncPollIntervalSeconds: 900,
        todoSyncTokenIsSet: false,
        todoSyncUrl: '',
        todoSyncView: 'today',
        wifiPasswordIsSet: false,
      },
      info: {
        capabilities: ['config-v1'],
        configRevision: 1,
        configSchemaVersion: 1,
        deviceId: 'device-1',
        firmwareVersion: '0.2.0',
        protocolVersion: 1,
      },
      name: 'Desk display',
    },
    forget: () => Effect.void,
    loadGallery: unused,
    reorderGallery: unused,
    scanWifi: () => Effect.succeed([]),
    setGallerySlideshow: unused,
    subscribeDisconnected: () => vi.fn(),
    uploadGalleryAsset: unused,
    ...overrides,
  }
}

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
    loadTodoSnapshot: () => Effect.succeed({ generatedAt: '2026-09-30T00:00:00.000Z', items: [], revision: 'empty' }),
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
