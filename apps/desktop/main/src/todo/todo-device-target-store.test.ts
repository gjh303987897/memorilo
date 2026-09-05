import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createTodoDeviceTargetStore } from './todo-device-target-store'

describe('todo device target store', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  it('round-trips private targets atomically and replaces by device ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-todo-targets-'))
    directories.push(directory)
    const path = join(directory, 'devices', 'todo-targets.json')
    const store = createTodoDeviceTargetStore(path)

    expect(await store.load()).toEqual([])
    await store.replace({ address: '192.168.4.23', deviceId: 'device-1' })
    await store.replace({ address: '192.168.4.24', deviceId: 'device-1' })
    expect(await store.load()).toEqual([{ address: '192.168.4.24', deviceId: 'device-1' }])
    expect(await readFile(path, 'utf8')).toContain('192.168.4.24')
    expect(await store.remove('device-1')).toEqual([])
  })

  it('rejects public, malformed, and oversized target values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-todo-targets-'))
    directories.push(directory)
    const store = createTodoDeviceTargetStore(join(directory, 'targets.json'))

    await expect(store.replace({ address: '8.8.8.8', deviceId: 'device-1' })).rejects.toThrow()
    await expect(store.replace({ address: '192.168.4.23', deviceId: '' })).rejects.toThrow()
  })
})
