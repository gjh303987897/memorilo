import type { DesktopDeviceGalleryTarget } from '@memorilo/desktop-api'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { parseLocalDeviceAddress } from '../device-local-management-client'

const maxTargets = 32

export interface TodoDeviceTargetStore {
  readonly load: () => Promise<readonly DesktopDeviceGalleryTarget[]>
  readonly replace: (target: DesktopDeviceGalleryTarget) => Promise<readonly DesktopDeviceGalleryTarget[]>
  readonly remove: (deviceId: string) => Promise<readonly DesktopDeviceGalleryTarget[]>
}

export function createTodoDeviceTargetStore(path: string): TodoDeviceTargetStore {
  const read = async (): Promise<DesktopDeviceGalleryTarget[]> => {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    }
    catch (error) {
      if (isNotFound(error))
        return []
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(raw) as unknown
    }
    catch {
      throw new Error('TODO device target file is invalid JSON')
    }
    if (!Array.isArray(value) || value.length > maxTargets)
      throw new Error('TODO device target file has an invalid shape')
    return value.map(parseTarget)
  }

  const write = async (targets: readonly DesktopDeviceGalleryTarget[]): Promise<void> => {
    if (targets.length > maxTargets)
      throw new Error('Too many TODO device targets')
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    await writeFile(temporary, `${JSON.stringify(targets)}\n`, 'utf8')
    await rename(temporary, path)
  }

  return {
    async load() {
      return read()
    },
    async replace(target) {
      const targets = (await read()).filter(candidate => candidate.deviceId !== target.deviceId)
      const next = [...targets, parseTarget(target)]
      await write(next)
      return next
    },
    async remove(deviceId) {
      if (!isDeviceId(deviceId))
        throw new TypeError('Invalid TODO device ID')
      const next = (await read()).filter(candidate => candidate.deviceId !== deviceId)
      await write(next)
      return next
    },
  }
}

function parseTarget(value: unknown): DesktopDeviceGalleryTarget {
  if (typeof value !== 'object' || value === null)
    throw new Error('TODO device target is invalid')
  const candidate = value as { address?: unknown, deviceId?: unknown }
  if (typeof candidate.address !== 'string' || typeof candidate.deviceId !== 'string' || !isDeviceId(candidate.deviceId))
    throw new Error('TODO device target is invalid')
  parseLocalDeviceAddress(candidate.address)
  return { address: candidate.address.trim(), deviceId: candidate.deviceId }
}

function isDeviceId(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[\uD800-\uDFFF]/u.test(value)
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}
