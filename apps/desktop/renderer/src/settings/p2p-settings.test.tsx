import type { DesktopApi } from '@memorilo/desktop-preload'
import { desktopConfigurationDefinition } from '@memorilo/desktop-config'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopConfigurationContext } from '../shared/configuration'
import { P2pSettings } from './p2p-settings'

function stubDesktop(overrides: Record<string, unknown> = {}) {
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: {
      p2p: {
        approvePairing: vi.fn(),
        confirmPairing: vi.fn(),
        enableDiscovery: vi.fn(),
        getLocalDevice: vi.fn(async () => ({ deviceId: 'local', deviceName: 'host-mac', peerId: 'peer-local' })),
        getPairingRequests: vi.fn(async () => []),
        getStatus: vi.fn(async () => ({ connectedPeers: [], discoveredPeers: [], error: null, peerId: 'peer-local', state: 'ready' as const })),
        listDevices: vi.fn(async () => []),
        listDiscoveredPeers: vi.fn(async () => []),
        removeDevice: vi.fn(),
        requestPairing: vi.fn(),
        updateDeviceName: vi.fn(async () => undefined),
        ...overrides,
      },
    } as unknown as DesktopApi,
  })
}

function renderP2p() {
  return render(
    <DesktopConfigurationContext value={desktopConfigurationDefinition.defaults}>
      <P2pSettings />
    </DesktopConfigurationContext>,
  )
}

afterEach(() => {
  Reflect.deleteProperty(window, 'desktop')
  vi.clearAllMocks()
})

describe('p2p settings', () => {
  it('shows device names before, during and after pairing and edits the local display name', async () => {
    const updateDeviceName = vi.fn(async () => undefined)
    stubDesktop({
      getPairingRequests: vi.fn(async () => [{ deviceId: 'pairing', deviceName: 'Phone', emoji: '😀😎🥳🤖👻', peerId: 'peer-phone', requestId: 'request' }]),
      listDevices: vi.fn(async () => [{ addedAt: 1, deviceId: 'paired', deviceName: 'Tablet', lastSeenAt: null, peerId: 'peer-tablet' }]),
      listDiscoveredPeers: vi.fn(async () => [{ deviceId: 'available', deviceName: 'Laptop', peerId: 'peer-laptop' }]),
      updateDeviceName,
    })

    const rendered = renderP2p()

    const name = await rendered.findByRole('textbox', { name: 'This device name' })
    expect(name).toHaveValue('host-mac')
    expect(rendered.getByText('Laptop')).toBeInTheDocument()
    expect(rendered.getByText('Phone')).toBeInTheDocument()
    expect(rendered.getByText(/Tablet/)).toBeInTheDocument()

    fireEvent.change(name, { target: { value: 'Study Mac' } })
    fireEvent.click(rendered.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(updateDeviceName).toHaveBeenCalledWith('Study Mac'))
    expect(rendered.getByRole('status')).toHaveTextContent('Device name updated.')
    rendered.unmount()
  })

  it('owns only local network sync and never renders Sync Server controls', async () => {
    stubDesktop()

    const rendered = renderP2p()
    await rendered.findByRole('textbox', { name: 'This device name' })

    expect(rendered.queryByText('Enable Sync Server')).not.toBeInTheDocument()
    expect(rendered.queryByText('Sync Server URL')).not.toBeInTheDocument()
    expect(rendered.queryByText('Sync Server peer ID')).not.toBeInTheDocument()
    expect(rendered.queryByText('Set up Sync Server')).not.toBeInTheDocument()

    rendered.unmount()
  })
})
