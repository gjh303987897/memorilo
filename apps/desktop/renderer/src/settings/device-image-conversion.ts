export const deviceImageWidth = 400
export const deviceImageHeight = 300
export const deviceImageBytes = deviceImageWidth * deviceImageHeight / 4

export type DeviceImageFit = 'contain' | 'cover'

interface PaletteColor {
  readonly blue: number
  readonly code: number
  readonly green: number
  readonly red: number
}

const palette: readonly PaletteColor[] = [
  { blue: 0, code: 0, green: 0, red: 0 },
  { blue: 255, code: 1, green: 255, red: 255 },
  { blue: 0, code: 2, green: 204, red: 255 },
  { blue: 22, code: 3, green: 35, red: 220 },
]

export function unpackDeviceImageRgba(bytes: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  if (bytes.byteLength !== deviceImageBytes)
    throw new TypeError(`Packed device image must contain exactly ${deviceImageBytes} bytes`)
  const rgba = new Uint8ClampedArray(deviceImageWidth * deviceImageHeight * 4)
  for (let y = 0; y < deviceImageHeight; y += 1) {
    for (let x = 0; x < deviceImageWidth; x += 1) {
      const packed = bytes[y * (deviceImageWidth / 4) + Math.floor(x / 4)]!
      const code = (packed >> (6 - (x % 4) * 2)) & 3
      const color = palette[code]!
      const offset = (y * deviceImageWidth + x) * 4
      rgba[offset] = color.red
      rgba[offset + 1] = color.green
      rgba[offset + 2] = color.blue
      rgba[offset + 3] = 255
    }
  }
  return rgba
}

export async function convertDeviceImage(
  file: Blob,
  fit: DeviceImageFit = 'contain',
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = deviceImageWidth
    canvas.height = deviceImageHeight
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!context)
      throw new Error('Canvas 2D image conversion is unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, deviceImageWidth, deviceImageHeight)
    const scale = fit === 'cover'
      ? Math.max(deviceImageWidth / bitmap.width, deviceImageHeight / bitmap.height)
      : Math.min(deviceImageWidth / bitmap.width, deviceImageHeight / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      (deviceImageWidth - width) / 2,
      (deviceImageHeight - height) / 2,
      width,
      height,
    )
    return quantizeDeviceImage(context.getImageData(0, 0, deviceImageWidth, deviceImageHeight))
  }
  finally {
    bitmap.close()
  }
}

export function quantizeDeviceImage(image: ImageData): Uint8Array {
  if (image.width !== deviceImageWidth || image.height !== deviceImageHeight)
    throw new TypeError(`Device image must be exactly ${deviceImageWidth}x${deviceImageHeight}`)
  if (image.data.byteLength !== deviceImageWidth * deviceImageHeight * 4)
    throw new TypeError('Device image RGBA data has an invalid length')

  const pixels = deviceImageWidth * deviceImageHeight
  const red = new Float32Array(pixels)
  const green = new Float32Array(pixels)
  const blue = new Float32Array(pixels)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4
    const alpha = (image.data[offset + 3] ?? 255) / 255
    red[pixel] = compositeOnWhite(image.data[offset] ?? 255, alpha)
    green[pixel] = compositeOnWhite(image.data[offset + 1] ?? 255, alpha)
    blue[pixel] = compositeOnWhite(image.data[offset + 2] ?? 255, alpha)
  }

  const packed = new Uint8Array(deviceImageBytes)
  for (let y = 0; y < deviceImageHeight; y += 1) {
    const leftToRight = y % 2 === 0
    for (let step = 0; step < deviceImageWidth; step += 1) {
      const x = leftToRight ? step : deviceImageWidth - 1 - step
      const pixel = y * deviceImageWidth + x
      const color = nearestColor(red[pixel]!, green[pixel]!, blue[pixel]!)
      const outputOffset = y * (deviceImageWidth / 4) + Math.floor(x / 4)
      packed[outputOffset] = (packed[outputOffset] ?? 0) | (color.code << (6 - (x % 4) * 2))

      const redError = red[pixel]! - color.red
      const greenError = green[pixel]! - color.green
      const blueError = blue[pixel]! - color.blue
      diffuse(red, green, blue, x, y, leftToRight ? 1 : -1, 0, redError, greenError, blueError, 7 / 16)
      diffuse(red, green, blue, x, y, leftToRight ? -1 : 1, 1, redError, greenError, blueError, 3 / 16)
      diffuse(red, green, blue, x, y, 0, 1, redError, greenError, blueError, 5 / 16)
      diffuse(red, green, blue, x, y, leftToRight ? 1 : -1, 1, redError, greenError, blueError, 1 / 16)
    }
  }
  return packed
}

function compositeOnWhite(channel: number, alpha: number): number {
  return channel * alpha + 255 * (1 - alpha)
}

function nearestColor(red: number, green: number, blue: number): PaletteColor {
  let nearest = palette[0]!
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const candidate of palette) {
    const distance = (red - candidate.red) ** 2
      + (green - candidate.green) ** 2
      + (blue - candidate.blue) ** 2
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest
}

function diffuse(
  red: Float32Array,
  green: Float32Array,
  blue: Float32Array,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  redError: number,
  greenError: number,
  blueError: number,
  weight: number,
): void {
  const targetX = x + deltaX
  const targetY = y + deltaY
  if (targetX < 0 || targetX >= deviceImageWidth || targetY >= deviceImageHeight)
    return
  const pixel = targetY * deviceImageWidth + targetX
  red[pixel] = clampChannel(red[pixel]! + redError * weight)
  green[pixel] = clampChannel(green[pixel]! + greenError * weight)
  blue[pixel] = clampChannel(blue[pixel]! + blueError * weight)
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value))
}
