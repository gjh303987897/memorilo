import { Match } from 'effect'

export type RendererPlatform = 'macos' | 'windows' | 'linux' | 'other'

export function getPlatform(): RendererPlatform {
  if (typeof window !== 'undefined' && typeof window.desktop !== 'undefined')
    return window.desktop.platform

  // Browser-only renderer tests and previews do not have the Electron bridge.
  // navigator.platform is only a fallback; Electron uses the native platform
  // value exposed by the preload bridge above.
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform
  return Match.value(platform).pipe(
    Match.when(value => /Mac|iPhone|iPad|iPod/i.test(value), () => 'macos' as const),
    Match.when(value => /Win/i.test(value), () => 'windows' as const),
    Match.when(value => /Linux/i.test(value), () => 'linux' as const),
    Match.orElse(() => 'other' as const),
  )
}

export function isMacOS(): boolean {
  return getPlatform() === 'macos'
}
