import type { DesktopProvisioningDevice, DesktopProvisioningPairingRequest } from '@memorilo/desktop-api'
import type { ApplyStatusEnvelope, DeviceConfigPatch } from '@memorilo/device-provisioning'
import type { DeviceProvisioningClient, DeviceProvisioningSession } from './device-provisioning-service'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DeviceProvisioningError } from './device-provisioning-service'
import { DeviceSettings } from './device-settings'

describe('device settings', () => {
  it.each(['normal', 'unmount-connection', 'cancel-connection', 'unmount-credentials', 'unmount-target', 'cancel-credentials'])('owns the connection throughout %s', async (scenario) => {
    let releaseLookup!: () => void
    const lookup = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    let disconnectedListener: (() => void) | undefined
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
      connected: true,
      subscribeDisconnected: (listener) => {
        disconnectedListener = listener
        return () => {
          disconnectedListener = undefined
        }
      },
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
          todoSyncEnabled: false,
          todoSyncUrl: '',
          todoSyncTokenIsSet: false,
          todoSyncPollIntervalSeconds: 900,
          todoSyncView: 'today',
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
    const hasLocalManagementToken = vi.fn(() => scenario.endsWith('credentials')
      ? Effect.promise(async () => {
          await lookup
          return false
        })
      : Effect.succeed(false))
    let savedAddress: string | null = null
    const loadTodoTarget = vi.fn(() => scenario === 'unmount-target'
      ? Effect.promise(async () => {
          await lookup
          return { status: null, target: null }
        })
      : Effect.succeed({ status: null, target: savedAddress ? { address: savedAddress, deviceId: 'device-1' } : null }))
    const loadGallery = vi.fn(() => Effect.fail(new DeviceProvisioningError({ code: 'local-management' })))
    const loadStatus = vi.fn(() => Effect.fail(new DeviceProvisioningError({ code: 'local-management' })))
    const loadTodos = vi.fn(() => Effect.fail(new DeviceProvisioningError({ code: 'local-management' })))
    const pushTodos = vi.fn(() => Effect.void)
    const refreshDevice = vi.fn(() => Effect.void)
    const nextDevicePage = vi.fn(() => Effect.void)
    const sleepDevice = vi.fn(() => Effect.void)
    const reorderGallery = vi.fn(() => Effect.void)
    const saveLocalManagementToken = vi.fn(() => Effect.void)
    const saveTodoTarget = vi.fn((_deviceId: string, address: string | null) => Effect.sync(() => {
      savedAddress = address
    }))
    const setGallerySlideshow = vi.fn(() => Effect.void)
    const uploadGalleryAsset = vi.fn(() => Effect.void)
    const interrupted = vi.fn()
    const client: DeviceProvisioningClient = {
      cancelSelection,
      clearLocalManagementToken,
      connect: () => Effect.tryPromise({
        catch: cause => new DeviceProvisioningError({ cause, code: 'connection-failed' }),
        try: () => new Promise<DeviceProvisioningSession>((resolve) => { resolveConnection = resolve }),
      }).pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
      deleteGalleryAsset,
      generateLocalManagementToken,
      hasLocalManagementToken,
      loadGallery,
      loadStatus,
      loadTodos,
      loadTodoTarget,
      pushTodos,
      refreshDevice,
      nextDevicePage,
      sleepDevice,
      reorderGallery,
      respondToPairing,
      saveLocalManagementToken,
      saveTodoTarget,
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

    if (scenario.endsWith('connection')) {
      if (scenario === 'cancel-connection')
        fireEvent.click(rendered.getByRole('button', { name: 'Cancel' }))
      else
        rendered.unmount()
      await waitFor(() => expect(interrupted).toHaveBeenCalledOnce())
      expect(hasLocalManagementToken).not.toHaveBeenCalled()
      if (scenario === 'cancel-connection')
        rendered.unmount()
      return
    }
    await act(async () => resolveConnection(session))
    if (scenario !== 'normal') {
      await waitFor(() => expect(hasLocalManagementToken).toHaveBeenCalled())
      if (scenario === 'cancel-credentials')
        fireEvent.click(rendered.getByRole('button', { name: 'Cancel' }))
      else
        rendered.unmount()
      await waitFor(() => expect(close).toHaveBeenCalledOnce())
      await act(async () => releaseLookup())
      expect(close).toHaveBeenCalledOnce()
      if (scenario.endsWith('credentials'))
        expect(loadTodoTarget).not.toHaveBeenCalled()
      if (scenario === 'cancel-credentials') {
        expect(rendered.queryByRole('textbox', { name: 'Device name' })).not.toBeInTheDocument()
        rendered.unmount()
      }
      return
    }
    const name = await rendered.findByRole('textbox', { name: 'Device name' })
    expect(name).toHaveValue('Desk display')
    expect(rendered.getByLabelText('Wi-Fi password')).toHaveValue('')

    fireEvent.change(name, { target: { value: 'Kitchen display' } })
    fireEvent.change(rendered.getByRole('spinbutton', { name: 'Sleep after idle seconds' }), { target: { value: '900' } })
    fireEvent.click(rendered.getByRole('button', { name: 'Apply settings' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      deviceName: 'Kitchen display',
      idleSleepSeconds: 900,
      localManagement: expect.objectContaining({ token: expect.any(String) }),
    })))
    expect(saveLocalManagementToken).toHaveBeenCalledWith('device-1', expect.any(String))
    expect(rendered.getByText('Settings applied successfully.')).toBeInTheDocument()

    act(() => {
      Object.defineProperty(session, 'connected', { value: false })
      disconnectedListener?.()
    })
    expect(rendered.getByRole('button', { name: 'Apply settings' })).toBeDisabled()
    expect(rendered.getByRole('button', { name: 'Scan for device' })).toBeEnabled()
    expect(rendered.getByText('Disconnected')).toBeInTheDocument()
    expect(rendered.getByRole('textbox', { name: 'Device name' })).toBeInTheDocument()
    expect(rendered.queryByRole('button', { name: 'Load status' })).not.toBeInTheDocument()
    expect(rendered.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
    expect(nextDevicePage).not.toHaveBeenCalled()

    rendered.unmount()
    expect(close).toHaveBeenCalledOnce()
    expect(cancelSelection).toHaveBeenCalledOnce()
  })
})
