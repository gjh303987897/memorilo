import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { ElectronEncryptedStringStore } from './electron-encrypted-string-store'

export interface LocalManagementCredentialStore {
  readonly clear: (deviceId: string) => Promise<void>
  readonly has: (deviceId: string) => Promise<boolean>
  readonly load: (deviceId: string) => Promise<string | null>
  readonly save: (deviceId: string, token: string) => Promise<void>
}

export class ElectronLocalManagementCredentialStore implements LocalManagementCredentialStore {
  constructor(readonly directory: string) {}

  clear(deviceId: string): Promise<void> {
    return this.store(deviceId).clear()
  }

  async has(deviceId: string): Promise<boolean> {
    return (await this.load(deviceId)) !== null
  }

  load(deviceId: string): Promise<string | null> {
    return this.store(deviceId).load()
  }

  save(deviceId: string, token: string): Promise<void> {
    assertLocalManagementToken(token)
    return this.store(deviceId).save(token)
  }

  private store(deviceId: string): ElectronEncryptedStringStore {
    assertDeviceId(deviceId)
    const filename = `${createHash('sha256').update(deviceId, 'utf8').digest('hex')}.enc`
    return new ElectronEncryptedStringStore(
      join(this.directory, filename),
      'device local management credential',
    )
  }
}

export function generateLocalManagementToken(): string {
  return randomBytes(32).toString('base64url')
}

export function assertLocalManagementToken(token: string): void {
  if (token.length < 32
    || token.length > 128
    || Array.from(token).some(character => character.codePointAt(0)! > 0x7F)) {
    throw new TypeError('Local management token must contain 32 to 128 ASCII characters')
  }
}

function assertDeviceId(deviceId: string): void {
  if (deviceId.length === 0 || deviceId.length > 256)
    throw new TypeError('Device ID must contain 1 to 256 characters')
}
