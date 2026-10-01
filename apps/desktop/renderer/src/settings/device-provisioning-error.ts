import { Data } from 'effect'

// The Effect factory returns the base class; it is intentionally invoked without `new` here.
// eslint-disable-next-line unicorn/throw-new-error
export class DeviceProvisioningError extends Data.TaggedError('DeviceProvisioningError')<{
  readonly cause?: unknown
  readonly code: 'apply-rejected' | 'bluetooth-unavailable' | 'connection-failed' | 'gallery-unavailable' | 'local-management' | 'protocol-error' | 'secure-storage' | 'serial-unavailable' | 'timeout' | 'wifi-scan-unavailable'
}> {}
