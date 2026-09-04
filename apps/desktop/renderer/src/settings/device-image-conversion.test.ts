import { describe, expect, it } from 'vitest'

import {
  deviceImageBytes,
  deviceImageHeight,
  deviceImageWidth,
  quantizeDeviceImage,
  unpackDeviceImageRgba,
} from './device-image-conversion'

function solidImage(red: number, green: number, blue: number, alpha = 255): ImageData {
  const data = new Uint8ClampedArray(deviceImageWidth * deviceImageHeight * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red
    data[offset + 1] = green
    data[offset + 2] = blue
    data[offset + 3] = alpha
  }
  return new ImageData(data, deviceImageWidth, deviceImageHeight)
}

describe('device image conversion', () => {
  it.each([
    ['black', [0, 0, 0], 0x00],
    ['white', [255, 255, 255], 0x55],
    ['yellow', [255, 204, 0], 0xAA],
    ['red', [220, 35, 22], 0xFF],
  ] as const)('packs a solid %s frame into the firmware 2bpp layout', (_name, channels, expected) => {
    const packed = quantizeDeviceImage(solidImage(channels[0], channels[1], channels[2]))

    expect(packed).toHaveLength(deviceImageBytes)
    expect(packed.every(byte => byte === expected)).toBe(true)
  })

  it('composites transparent input onto the panel white background', () => {
    const packed = quantizeDeviceImage(solidImage(0, 0, 0, 0))
    expect(packed.every(byte => byte === 0x55)).toBe(true)
  })

  it('rejects dimensions other than the physical panel size', () => {
    expect(() => quantizeDeviceImage(new ImageData(4, 4))).toThrow('exactly 400x300')
  })

  it('decodes packed pixels for an exact four-color preview', () => {
    const packed = new Uint8Array(deviceImageBytes).fill(0x1B)
    const rgba = unpackDeviceImageRgba(packed)
    expect(Array.from(rgba.slice(0, 16))).toEqual([
      0,
      0,
      0,
      255,
      255,
      255,
      255,
      255,
      255,
      204,
      0,
      255,
      220,
      35,
      22,
      255,
    ])
  })
})
