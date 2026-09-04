import type { DesktopProvisioningDevice, DesktopProvisioningPairingRequest } from '@memorilo/desktop-api'
import type { ApplyStatusEnvelope, DeviceConfigPatch } from '@memorilo/device-provisioning'
import type { DeviceProvisioningClient, DeviceProvisioningSession } from './device-provisioning-service'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DeviceProvisioningError } from './device-provisioning-service'
import { DeviceSettings } from './device-settings'

describe('device settings', () => {
  it('scans, pairs, edits, applies, and closes the selected device', async () => {
    let devicesListener: ((devices: readonly DesktopProvisioningDevice[]) => void) | undefined
    let pairingListener: ((request: DesktopProvisioningPairingRequest) => void) | undefined
    let resolveConnection!: (session: DeviceProvisioningSession) => void
    const apply = vi.fn((_patch: DeviceConfigPatch) => Effect.succeed<ApplyStatusEnvelope>({
      protocolVersion: 1,
      requestId: 'apply-1',
      revision: 4,
      status: 'accepted',
    }))
    const close = vi.fn(() => Effect.void)
    const forget = vi.fn(() => Effect.void)
    const session: DeviceProvisioningSession = {
      apply,
      close,
      device: {
        config: {
          configSchemaVersion: 1,
          deviceName: 'Desk display',
          idleSleepSeconds: 600,
          localManagementTokenIsSet: false,
          protocolVersion: 1,
          revision: 3,
          selectionPolicy: 'Remember',
          timezone: 'Asia/Shanghai',
          wifiPasswordIsSet: true,
          wifiSsid: 'Study',
        },
        info: {
          capabilities: ['config-v1'],
          configRevision: 3,
          configSchemaVersion: 1,
          deviceId: 'device-1',
          firmwareVersion: '0.2.0',
          protocolVersion: 1,
        },
        name: 'Desk display',
      },
      forget,
    }
    const selectDevice = vi.fn(() => Effect.void)
    const respondToPairing = vi.fn(() => Effect.void)
    const cancelSelection = vi.fn(() => Effect.void)
    const clearLocalManagementToken = vi.fn(() => Effect.void)
    const deleteGalleryAsset = vi.fn(() => Effect.void)
    const generateLocalManagementToken = vi.fn(() => Effect.succeed('a'.repeat(32)))
    const hasLocalManagementToken = vi.fn(() => Effect.succeed(false))
    const loadGallery = vi.fn(() => Effect.fail(new DeviceProvisioningError({ code: 'local-management' })))
    const reorderGallery = vi.fn(() => Effect.void)
    const saveLocalManagementToken = vi.fn(() => Effect.void)
    const setGallerySlideshow = vi.fn(() => Effect.void)
    const uploadGalleryAsset = vi.fn(() => Effect.void)
    const client: DeviceProvisioningClient = {
      cancelSelection,
      clearLocalManagementToken,
      connect: () => Effect.tryPromise({
        catch: cause => new DeviceProvisioningError({ cause, code: 'connection-failed' }),
        try: () => new Promise((resolve) => { resolveConnection = resolve }),
      }),
      deleteGalleryAsset,
      generateLocalManagementToken,
      hasLocalManagementToken,
      loadGallery,
      reorderGallery,
      respondToPairing,
      saveLocalManagementToken,
      setGallerySlideshow,
      selectDevice,
      subscribeDevices: (listener) => {
        devicesListener = listener
        return vi.fn()
      },
      subscribePairing: (listener) => {
        pairingListener = listener
        return vi.fn()
      },
      uploadGalleryAsset,
    }
    const rendered = render(<DeviceSettings client={client} />)

    fireEvent.click(rendered.getByRole('button', { name: 'Scan for device' }))
    expect(rendered.getByRole('status')).toHaveTextContent('Scanning for nearby')

    act(() => devicesListener?.([{ deviceId: 'device-1', deviceName: 'Desk display' }]))
    fireEvent.click(rendered.getByRole('button', { name: /Desk display/ }))
    expect(selectDevice).toHaveBeenCalledWith({ deviceId: 'device-1', deviceName: 'Desk display' })

    act(() => pairingListener?.({
      deviceId: 'device-1',
      pairingKind: 'providePin',
      requestId: 'pairing-1',
    }))
    fireEvent.change(rendered.getByRole('textbox', { name: 'Pairing code' }), { target: { value: '12a3456' } })
    fireEvent.click(rendered.getByRole('button', { name: 'Pair' }))
    await waitFor(() => expect(respondToPairing).toHaveBeenCalledWith({
      confirmed: true,
      pin: '123456',
      requestId: 'pairing-1',
    }))

    await act(async () => resolveConnection(session))
    const name = await rendered.findByRole('textbox', { name: 'Device name' })
    expect(name).toHaveValue('Desk display')
    expect(rendered.getByLabelText('Wi-Fi password')).toHaveValue('')

    fireEvent.change(name, { target: { value: 'Kitchen display' } })
    fireEvent.change(rendered.getByRole('spinbutton', { name: 'Sleep after idle seconds' }), { target: { value: '900' } })
    fireEvent.click(rendered.getByRole('button', { name: 'Generate access token' }))
    await waitFor(() => expect(rendered.getByText(/A new write-only token will be installed/)).toBeInTheDocument())
    fireEvent.click(rendered.getByRole('button', { name: 'Apply settings' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      deviceName: 'Kitchen display',
      idleSleepSeconds: 900,
      localManagement: { token: 'a'.repeat(32) },
    })))
    expect(saveLocalManagementToken).toHaveBeenCalledWith('device-1', 'a'.repeat(32))
    expect(rendered.getByText('Settings applied successfully.')).toBeInTheDocument()

    rendered.unmount()
    expect(close).toHaveBeenCalledOnce()
    expect(cancelSelection).toHaveBeenCalledOnce()
  })
})
