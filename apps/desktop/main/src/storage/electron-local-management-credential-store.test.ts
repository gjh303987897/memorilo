import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ encryptionAvailable: true }))

vi.mock('electron', () => ({
  safeStorage: {
    decryptString: (encrypted: Uint8Array) => Buffer.from(Buffer.from(encrypted).toString('utf8'), 'base64').toString('utf8'),
    encryptString: (value: string) => Buffer.from(Buffer.from(value, 'utf8').toString('base64'), 'utf8'),
    isEncryptionAvailable: () => mocks.encryptionAvailable,
  },
}))

const {
  ElectronLocalManagementCredentialStore,
  generateLocalManagementToken,
} = await import('./electron-local-management-credential-store')

describe('electron local management credential store', () => {
  const directories: string[] = []

  afterEach(async () => {
    mocks.encryptionAvailable = true
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  it('stores credentials encrypted and isolated by device ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-device-credential-'))
    directories.push(directory)
    const store = new ElectronLocalManagementCredentialStore(directory)

    await store.save('device/one', 'a'.repeat(32))
    await store.save('device-two', 'b'.repeat(32))

    expect(await store.load('device/one')).toBe('a'.repeat(32))
    expect(await store.load('device-two')).toBe('b'.repeat(32))
    const files = await readdir(directory)
    expect(files).toHaveLength(2)
    expect(files.every(file => /^[a-f\d]{64}\.enc$/u.test(file))).toBe(true)
    expect(await readFile(join(directory, files[0]!), 'utf8')).not.toContain('a'.repeat(32))

    await store.clear('device/one')
    await expect(store.has('device/one')).resolves.toBe(false)
    await expect(store.has('device-two')).resolves.toBe(true)
  })

  it('generates protocol-compatible tokens and rejects invalid values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-device-credential-'))
    directories.push(directory)
    const store = new ElectronLocalManagementCredentialStore(directory)
    const token = generateLocalManagementToken()

    expect(token).toMatch(/^[\w-]{43}$/u)
    await expect(store.save('device-one', token)).resolves.toBeUndefined()
    expect(() => store.save('device-one', 'short')).toThrow('32 to 128 ASCII')
    expect(() => store.save('device-one', `令${'a'.repeat(31)}`)).toThrow('32 to 128 ASCII')
  })

  it('refuses to persist when operating-system encryption is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-device-credential-'))
    directories.push(directory)
    const store = new ElectronLocalManagementCredentialStore(directory)
    mocks.encryptionAvailable = false

    await expect(store.save('device-one', 'a'.repeat(32))).rejects.toThrow('Operating-system encryption is unavailable')
  })
})
