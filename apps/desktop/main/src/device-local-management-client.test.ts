import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
  DeviceLocalManagementClient,
  parseLocalDeviceAddress,
} from './device-local-management-client'

const token = 'a'.repeat(32)

describe('device local management client', () => {
  it('accepts only literal private-network targets', () => {
    expect(parseLocalDeviceAddress('192.168.4.23').toString()).toBe('http://192.168.4.23/')
    expect(parseLocalDeviceAddress('10.0.0.2:8080').toString()).toBe('http://10.0.0.2:8080/')
    expect(() => parseLocalDeviceAddress('https://192.168.4.23')).toThrow()
    expect(() => parseLocalDeviceAddress('8.8.8.8')).toThrow()
    expect(() => parseLocalDeviceAddress('device.example.com')).toThrow()
  })

  it('keeps the bearer token in main and parses bounded gallery metadata', async () => {
    const request = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(JSON.stringify({
      capacityBytes: 4_194_304,
      catalog: {
        assets: [{
          byteLength: 30_000,
          checksum: 123,
          createdAtUnixSeconds: 456,
          id: 1,
          name: 'Image',
        }],
        slideshowIntervalSeconds: null,
      },
      fullRefreshSeconds: 20,
      imageBytes: 30_000,
      lastError: null,
      maxAssets: 100,
      mutationRevision: 2,
    }), { status: 200 }))
    const client = new DeviceLocalManagementClient(credentialStore(token), request as typeof fetch)

    const gallery = await Effect.runPromise(client.loadGallery({
      address: '192.168.4.23',
      deviceId: 'device-1',
    }))

    expect(gallery.catalog.assets[0]?.name).toBe('Image')
    expect(request).toHaveBeenCalledWith(new URL('http://192.168.4.23/v1/gallery'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      redirect: 'error',
    }))
  })

  it('validates exact image size before issuing an upload', async () => {
    const request = vi.fn()
    const client = new DeviceLocalManagementClient(credentialStore(token), request as typeof fetch)
    const effect = client.uploadAsset({
      address: '192.168.4.23',
      bytes: new Uint8Array(12),
      createdAtUnixSeconds: 0,
      deviceId: 'device-1',
      name: 'small',
    })

    await expect(Effect.runPromise(effect)).rejects.toMatchObject({
      code: 'invalid-input',
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('pushes and reads bounded read-only TODO snapshots', async () => {
    const snapshot = {
      generatedAt: '2026-09-05T00:00:00Z',
      items: [{ allDay: true, dueDate: '2026-09-05', dueTime: null, id: 'task-1', noteTitle: 'Note', parentId: null, revision: 'item-r1', status: 'todo' as const, text: 'Buy milk', topicTitle: 'Topic' }],
      revision: 'snapshot-r1',
    }
    const request = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => init?.method === 'POST'
      ? new Response(null, { status: 202 })
      : new Response(JSON.stringify({ lastError: null, lastEvent: 'updated', lastSuccessUnixSeconds: 1, revision: snapshot.revision, snapshot, source: 'client-lan-push' }), { status: 200 }))
    const client = new DeviceLocalManagementClient(credentialStore(token), request as typeof fetch)
    const target = { address: '192.168.4.23', deviceId: 'device-1' }

    await Effect.runPromise(client.pushTodos({ ...target, snapshot }))
    const state = await Effect.runPromise(client.loadTodos(target))

    expect(state.snapshot?.items[0]?.text).toBe('Buy milk')
    expect(request).toHaveBeenCalledWith(new URL('http://192.168.4.23/v1/todos'), expect.objectContaining({ method: 'POST' }))
  })

  it('reads device status and sends authenticated remote commands', async () => {
    const request = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({
          firmwareVersion: '0.3.0',
          network: {
            consecutiveFailures: 0,
            ipv4: '192.168.4.23',
            mqttConnected: true,
            phase: 'online',
            retryAtMs: null,
            timeSynchronized: true,
          },
          uptimeMs: 42_000,
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ accepted: true }), { status: 202 })
    })
    const client = new DeviceLocalManagementClient(credentialStore(token), request as typeof fetch)
    const target = { address: '192.168.4.23', deviceId: 'device-1' }

    await expect(Effect.runPromise(client.loadStatus(target))).resolves.toMatchObject({
      network: { ipv4: '192.168.4.23', mqttConnected: true, phase: 'online' },
    })
    await Effect.runPromise(client.refreshDevice(target))
    await Effect.runPromise(client.nextDevicePage(target))
    await Effect.runPromise(client.sleepDevice(target))

    expect(request).toHaveBeenCalledWith(new URL('http://192.168.4.23/v1/status'), expect.objectContaining({ method: 'GET' }))
    expect(request).toHaveBeenCalledWith(new URL('http://192.168.4.23/v1/commands/refresh'), expect.objectContaining({ method: 'POST' }))
    expect(request).toHaveBeenCalledWith(new URL('http://192.168.4.23/v1/commands/next-page'), expect.objectContaining({ method: 'POST' }))
    expect(request).toHaveBeenCalledWith(new URL('http://192.168.4.23/v1/commands/sleep'), expect.objectContaining({ method: 'POST' }))
  })

  it('fails without exposing or inventing a missing credential', async () => {
    const client = new DeviceLocalManagementClient(credentialStore(null), vi.fn() as typeof fetch)
    await expect(Effect.runPromise(client.loadGallery({
      address: '192.168.4.23',
      deviceId: 'device-1',
    }))).rejects.toMatchObject({ code: 'credential-missing' })
  })
})

function credentialStore(stored: string | null) {
  return {
    clear: vi.fn(async () => undefined),
    has: vi.fn(async () => stored !== null),
    load: vi.fn(async () => stored),
    save: vi.fn(async () => undefined),
  }
}
