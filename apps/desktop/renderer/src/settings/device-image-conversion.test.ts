import { describe, expect, it } from 'vitest'

import {
  defaultDeviceImageCrop,
  deviceImageBytes,
  deviceImageCropLayout,
  deviceImageHeight,
  deviceImageWidth,
  moveDeviceImageCrop,
  normalizeDeviceImageCrop,
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
  it('fits the complete source image at the minimum zoom', () => {
    expect(deviceImageCropLayout(1920, 1080, defaultDeviceImageCrop)).toEqual({
      height: 225,
      scale: 1 / 4.8,
      width: 400,
      x: 0,
      y: 37.5,
    })
  })

  it('keeps a square source fully visible inside the 4:3 panel', () => {
    expect(deviceImageCropLayout(720, 720, defaultDeviceImageCrop)).toEqual({
      height: 300,
      scale: 5 / 12,
      width: 300,
      x: 50,
      y: 0,
    })
  })

  it('maps the selected focal point and zoom to the physical 4:3 panel', () => {
    expect(deviceImageCropLayout(800, 400, defaultDeviceImageCrop)).toEqual({
      height: 200,
      scale: 0.5,
      width: 400,
      x: 0,
      y: 50,
    })
    expect(deviceImageCropLayout(800, 400, {
      focusX: 0.5,
      focusY: 0.5,
      zoom: 2,
    })).toEqual({
      height: 400,
      scale: 1,
      width: 800,
      x: -200,
      y: -50,
    })
  })

  it('clamps the crop focal point so the panel never exposes an empty edge', () => {
    expect(normalizeDeviceImageCrop({ focusX: -4, focusY: 9, zoom: 2 }, 800, 400)).toEqual({
      focusX: 0.25,
      focusY: 0.625,
      zoom: 2,
    })
  })

  it('moves the selected source region one-to-one with a pointer drag', () => {
    expect(moveDeviceImageCrop({ ...defaultDeviceImageCrop, zoom: 2 }, 75, 0, 800, 400)).toEqual({
      focusX: 0.40625,
      focusY: 0.5,
      zoom: 2,
    })
  })

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
