import { Data } from 'effect'

type DeviceProvisioningErrorCode = 'apply-rejected' | 'bluetooth-unavailable' | 'gallery-unavailable' | 'local-management' | 'protocol-error' | 'secure-storage' | 'serial-access-denied' | 'serial-unavailable' | 'connection-failed' | 'timeout' | 'wifi-scan-unavailable'
interface DeviceProvisioningErrorFields {
  readonly cause?: unknown
  readonly code: DeviceProvisioningErrorCode
}

// The Effect factory returns the base class; it is intentionally invoked without `new` here.
// eslint-disable-next-line unicorn/throw-new-error
export class DeviceProvisioningError extends Data.TaggedError('DeviceProvisioningError')<{ readonly code: DeviceProvisioningErrorCode }> {
  declare readonly cause?: unknown

  constructor(fields: DeviceProvisioningErrorFields) {
    super({ code: fields.code })
    if (fields.cause !== undefined)
      Object.defineProperty(this, 'cause', { configurable: true, enumerable: true, value: fields.cause })
  }
}
