import type { DesktopApi } from '@memorilo/desktop-preload'
import { desktopConfigurationDefinition } from '@memorilo/desktop-config'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopConfigurationContext } from '../shared/configuration'
import { SyncServerSettings } from './sync-server-settings'

interface ServerStatusOverrides {
  configured?: boolean
  enabled?: boolean
  error?: string | null
  modes?: readonly ('authoritative' | 'relay')[]
  state?: string
  url?: string
}

function stubDesktop(status: ServerStatusOverrides = {}, onSubscribe?: (listener: (event: unknown) => void) => void) {
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: {
      p2p: {
        getServerStatus: vi.fn(async () => ({
          configured: true,
          enabled: true,
          error: null,
          generation: 2,
          membershipEpoch: 3,
          modes: ['authoritative'],
          peerId: 'server-peer',
          policyEpoch: 4,
          state: 'synced',
          url: 'wss://sync.example.test',
          ...status,
        })),
      },
      subscribeSyncServerEvents: vi.fn((listener) => {
        onSubscribe?.(listener)
        return vi.fn()
      }),
    } as unknown as DesktopApi,
  })
}

function renderSettings() {
  return render(
    <DesktopConfigurationContext value={desktopConfigurationDefinition.defaults}>
      <SyncServerSettings />
    </DesktopConfigurationContext>,
  )
}

afterEach(() => {
  Reflect.deleteProperty(window, 'desktop')
  vi.clearAllMocks()
})

describe('sync server settings', () => {
  it('shows connection state, address and active mode without duplicating the URL', async () => {
    stubDesktop({ modes: ['authoritative'], state: 'synced' })
    const rendered = renderSettings()

    expect(await rendered.findByText('Synced')).toBeInTheDocument()
    expect(rendered.getByText('Authoritative peer')).toBeInTheDocument()
    expect(rendered.getByText(/keeps plaintext server data/)).toBeInTheDocument()
    expect(rendered.getAllByText('wss://sync.example.test')).toHaveLength(1)

    rendered.unmount()
  })

  it('surfaces relay mode as a warning', async () => {
    stubDesktop({ modes: ['relay'] })
    const rendered = renderSettings()

    expect(await rendered.findByText('Relay mode is active')).toBeInTheDocument()
    expect(rendered.getByText(/cannot restore anything while your other devices are offline/)).toBeInTheDocument()

    rendered.unmount()
  })

  it('offers pairing setup when the server is not configured', async () => {
    stubDesktop({ configured: false, enabled: false, modes: [], state: 'setup-required', url: '' })
    const rendered = renderSettings()

    expect(await rendered.findByText('Set up Sync Server')).toBeInTheDocument()

    rendered.unmount()
  })

  it('reports a data reset through the live status region', async () => {
    let listener: ((event: unknown) => void) | undefined
    stubDesktop({}, (next) => {
      listener = next
    })
    const rendered = renderSettings()
    await rendered.findByText('Synced')

    act(() => listener?.({
      previousGeneration: 1,
      status: {
        configured: true,
        enabled: true,
        error: null,
        generation: 2,
        membershipEpoch: 3,
        modes: ['authoritative'],
        peerId: 'server-peer',
        policyEpoch: 4,
        state: 'connecting',
        url: 'wss://sync.example.test',
      },
      type: 'account-data-reset',
    }))

    expect(rendered.getAllByRole('status').some(node => node.textContent?.includes('Local data remains on this device'))).toBe(true)
    rendered.unmount()
  })
})
