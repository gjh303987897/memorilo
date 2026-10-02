import type { DesktopDeviceGalleryAsset, DesktopDeviceGalleryStatus } from '@memorilo/desktop-api'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import type { DeviceImageCrop, DeviceImageCropLayout } from './device-image-conversion'
import type { DeviceProvisioningClient, DeviceProvisioningSession, GalleryUploadProgress } from './device-provisioning-service'
import { Button, SelectField, Status, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Effect } from 'effect'
import { ArrowDown, ArrowUp, ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { Component, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deviceGalleryStyles as styles } from './device-gallery.stylex'
import {
  convertDecodedDeviceImage,
  decodeDeviceImage,
  defaultDeviceImageCrop,
  deviceImageCropLayout,
  deviceImageHeight,
  deviceImageWidth,
  moveDeviceImageCrop,
  normalizeDeviceImageCrop,
  unpackDeviceImageRgba,
} from './device-image-conversion'
import { DeviceProvisioningError } from './device-provisioning-service'

type GalleryPhase = 'converting' | 'error' | 'idle' | 'loading' | 'ready' | 'saving' | 'success' | 'uploading'
type GalleryUploadProgressView = GalleryUploadProgress & { readonly phase: 'committing' | 'sending' }

class GalleryDeviceError extends Error {}

interface SourceImage {
  readonly bitmap: ImageBitmap
  readonly height: number
  readonly width: number
}

export function DeviceGallery({
  ...props
}: {
  client: DeviceProvisioningClient
  deviceId: string
  session?: DeviceProvisioningSession | null
  enabled: boolean
}) {
  const { t } = useTranslation('settings')
  return (
    <DeviceGalleryErrorBoundary
      fallback={t('deviceGalleryRenderError')}
      retry={t('deviceGalleryReset')}
    >
      <DeviceGalleryContent {...props} />
    </DeviceGalleryErrorBoundary>
  )
}

function DeviceGalleryContent({
  client,
  deviceId,
  session,
  enabled,
}: {
  client: DeviceProvisioningClient
  deviceId: string
  session?: DeviceProvisioningSession | null
  enabled: boolean
}) {
  const { t } = useTranslation('settings')
  const [gallery, setGallery] = useState<DesktopDeviceGalleryStatus | null>(null)
  const [phase, setPhase] = useState<GalleryPhase>('idle')
  const [packedImage, setPackedImage] = useState<Uint8Array | null>(null)
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null)
  const [crop, setCrop] = useState<DeviceImageCrop>(defaultDeviceImageCrop)
  const [uploadProgress, setUploadProgress] = useState<GalleryUploadProgressView | null>(null)
  const [imageName, setImageName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const operation = useRef(0)
  const autoLoadSession = useRef<DeviceProvisioningSession | null | undefined>(undefined)
  const autoLoadDeviceId = useRef<string | null>(null)

  useEffect(() => () => {
    operation.current += 1
  }, [])

  useEffect(() => {
    if (!sourceImage)
      return
    return () => {
      sourceImage.bitmap.close()
    }
  }, [sourceImage])

  useEffect(() => {
    if (!sourceImage)
      return
    let active = true
    const timeout = globalThis.setTimeout(() => {
      try {
        const converted = convertDecodedDeviceImage(sourceImage.bitmap, crop)
        if (!active)
          return
        setPackedImage(converted)
        setPhase('idle')
      }
      catch {
        if (active)
          setPhase('error')
      }
    }, 80)
    return () => {
      active = false
      globalThis.clearTimeout(timeout)
    }
  }, [crop, sourceImage])

  const target = { address: deviceAddressForDeviceId(deviceId), deviceId }
  const load = useCallback(() => session
    ? session.loadGallery()
    : client.loadGallery({ address: deviceAddressForDeviceId(deviceId), deviceId }), [client, deviceId, session])
  const uploadAsset = (
    input: Parameters<DeviceProvisioningClient['uploadGalleryAsset']>[0],
    onProgress: (progress: GalleryUploadProgress) => void,
  ) => session
    ? session.uploadGalleryAsset(input.bytes, input.name, input.createdAtUnixSeconds, onProgress)
    : client.uploadGalleryAsset(input, onProgress)
  const deleteAsset = (id: number) => session ? session.deleteGalleryAsset(id) : client.deleteGalleryAsset(target, id)
  const reorder = (order: readonly number[]) => session ? session.reorderGallery(order) : client.reorderGallery(target, order)
  const setSlideshowOp = (interval: number | null) => session
    ? session.setGallerySlideshow(interval)
    : client.setGallerySlideshow(target, interval)
  const updateCrop = (next: DeviceImageCrop): void => {
    setPackedImage(null)
    setPhase('converting')
    setCrop(next)
  }
  const refresh = useCallback(async (): Promise<DesktopDeviceGalleryStatus | null> => {
    if (!enabled)
      return null
    const sequence = ++operation.current
    setPhase('loading')
    try {
      const next = await Effect.runPromise(load())
      if (operation.current !== sequence)
        return null
      setGallery(next)
      setDeviceError(null)
      setPhase(next.lastError ? 'error' : 'ready')
      return next
    }
    catch (error) {
      if (operation.current === sequence) {
        setDeviceError(galleryErrorMessage(error))
        setPhase('error')
      }
      return null
    }
  }, [enabled, load])

  useEffect(() => {
    if (!enabled) {
      autoLoadSession.current = undefined
      autoLoadDeviceId.current = null
      return
    }
    if (autoLoadSession.current === session && autoLoadDeviceId.current === deviceId)
      return
    autoLoadSession.current = session
    autoLoadDeviceId.current = deviceId
    void refresh()
    return () => {
      operation.current += 1
      if (autoLoadSession.current === session && autoLoadDeviceId.current === deviceId) {
        autoLoadSession.current = undefined
        autoLoadDeviceId.current = null
      }
    }
  }, [deviceId, enabled, refresh, session])

  const waitForMutation = async (_previous: DesktopDeviceGalleryStatus): Promise<DesktopDeviceGalleryStatus> => {
    let lastError: unknown = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250))
      try {
        const next = await Effect.runPromise(load())
        if (next.lastError)
          throw new GalleryDeviceError(next.lastError)
        // The mutation response is the commit acknowledgement. Some deployed
        // firmware does not increment mutationRevision for every transport, so
        // requiring a revision/catalog diff here turns a successful update into
        // a false timeout. A clean read is the authoritative refreshed state.
        return next
      }
      catch (error) {
        if (error instanceof GalleryDeviceError)
          throw error
        if (error instanceof DeviceProvisioningError && error.code === 'gallery-unavailable')
          throw error
        lastError = error
      }
    }
    throw lastError ?? new Error('gallery-mutation-timeout')
  }

  const chooseImage = async (file: File | null | undefined): Promise<void> => {
    if (!file)
      return
    setPhase('converting')
    try {
      const bitmap = await decodeDeviceImage(file)
      setPackedImage(null)
      setCrop(defaultDeviceImageCrop)
      setSourceImage({ bitmap, height: bitmap.height, width: bitmap.width })
      setImageName(Array.from(file.name).slice(0, 64).join(''))
    }
    catch {
      setPhase('error')
    }
  }

  const upload = async (): Promise<void> => {
    if (!gallery || !packedImage || imageName.trim().length === 0)
      return
    const sequence = ++operation.current
    setPhase('uploading')
    setUploadProgress({ phase: 'sending', sentBytes: 0, totalBytes: packedImage.byteLength })
    try {
      await Effect.runPromise(uploadAsset({
        ...target,
        bytes: packedImage,
        createdAtUnixSeconds: Math.floor(Date.now() / 1000),
        name: imageName.trim(),
      }, (progress) => {
        if (operation.current === sequence)
          setUploadProgress({ ...progress, phase: 'sending' })
      }))
      setUploadProgress(previous => previous && { ...previous, phase: 'committing' })
      const next = await waitForMutation(gallery)
      if (operation.current !== sequence)
        return
      setGallery(next)
      setDeviceError(null)
      setPackedImage(null)
      setSourceImage(null)
      setCrop(defaultDeviceImageCrop)
      setImageName('')
      setUploadProgress(null)
      setPhase('success')
    }
    catch (error) {
      if (operation.current === sequence) {
        setDeviceError(galleryErrorMessage(error))
        setUploadProgress(null)
        setPhase('error')
      }
    }
  }

  const confirmDelete = async (asset: DesktopDeviceGalleryAsset): Promise<void> => {
    if (!gallery)
      return
    if (pendingDelete !== asset.id) {
      setPendingDelete(asset.id)
      return
    }
    const sequence = ++operation.current
    setPhase('saving')
    try {
      await Effect.runPromise(deleteAsset(asset.id))
      const next = await waitForMutation(gallery)
      if (operation.current !== sequence)
        return
      setGallery(next)
      setPendingDelete(null)
      setPhase('success')
    }
    catch (error) {
      if (operation.current === sequence) {
        setDeviceError(galleryErrorMessage(error))
        setPhase('error')
      }
    }
  }

  const move = async (index: number, delta: -1 | 1): Promise<void> => {
    if (!gallery)
      return
    const targetIndex = index + delta
    if (targetIndex < 0 || targetIndex >= gallery.catalog.assets.length)
      return
    const previous = gallery
    const assets = [...gallery.catalog.assets]
    const [asset] = assets.splice(index, 1)
    if (!asset)
      return
    assets.splice(targetIndex, 0, asset)
    setGallery({ ...gallery, catalog: { ...gallery.catalog, assets } })
    setPhase('saving')
    try {
      await Effect.runPromise(reorder(assets.map(candidate => candidate.id)))
      setGallery(await waitForMutation(previous))
      setPhase('success')
    }
    catch (error) {
      setGallery(previous)
      setDeviceError(galleryErrorMessage(error))
      setPhase('error')
    }
  }

  const setSlideshow = async (value: string): Promise<void> => {
    if (!gallery)
      return
    const previous = gallery
    const intervalSeconds = value === 'off' ? null : Number(value)
    setPhase('saving')
    try {
      await Effect.runPromise(setSlideshowOp(intervalSeconds))
      setGallery(await waitForMutation(previous))
      setPhase('success')
    }
    catch (error) {
      setGallery(previous)
      setDeviceError(galleryErrorMessage(error))
      setPhase('error')
    }
  }

  const usedBytes = gallery?.catalog.assets.reduce((sum, asset) => sum + asset.byteLength, 0) ?? 0

  return (
    <section {...stylex.props(styles.root)} aria-labelledby="device-gallery-heading">
      <div {...stylex.props(styles.headingRow)}>
        <div {...stylex.props(styles.headingCopy)}>
          <h3 id="device-gallery-heading" {...stylex.props(styles.heading)}>{t('deviceGallery')}</h3>
          <p {...stylex.props(styles.description)}>{t('deviceGalleryDescription')}</p>
        </div>
        <Button
          disabled={!enabled || phase === 'loading'}
          type="button"
          variant="secondary"
          xstyle={styles.compactButton}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" size={13} />
          {t('deviceGalleryConnect')}
        </Button>
      </div>

      {gallery
        ? (
            <>
              <div {...stylex.props(styles.metrics)}>
                <span>{t('deviceGalleryCount', { count: gallery.catalog.assets.length, max: gallery.maxAssets })}</span>
                <span>{t('deviceGalleryStorage', { total: Math.floor(gallery.capacityBytes / 1024), used: Math.floor(usedBytes / 1024) })}</span>
                <span>{t('deviceGalleryRefreshCost', { seconds: gallery.fullRefreshSeconds })}</span>
              </div>

              <div {...stylex.props(styles.uploadGrid)}>
                <div {...stylex.props(styles.preview)}>
                  {sourceImage
                    ? (
                        <DeviceImageCropEditor
                          crop={crop}
                          disabled={phase === 'uploading'}
                          source={sourceImage.bitmap}
                          sourceHeight={sourceImage.height}
                          sourceWidth={sourceImage.width}
                          onChange={updateCrop}
                        />
                      )
                    : (
                        <div {...stylex.props(styles.emptyPreview)}>
                          <ImagePlus aria-hidden="true" size={24} strokeWidth={1.5} />
                          <span>{t('deviceGalleryChooseImage')}</span>
                        </div>
                      )}
                </div>
                <div {...stylex.props(styles.uploadControls)}>
                  <label {...stylex.props(styles.fileButton)}>
                    <input
                      accept="image/*"
                      disabled={phase === 'converting' || phase === 'uploading'}
                      type="file"
                      {...stylex.props(styles.fileInput)}
                      onChange={event => void chooseImage(event.target.files?.[0])}
                    />
                    {t('deviceGalleryChooseImage')}
                  </label>
                  {packedImage
                    ? (
                        <div {...stylex.props(styles.convertedPreview)}>
                          <span {...stylex.props(styles.previewLabel)}>{t('deviceGalleryDevicePreview')}</span>
                          <DeviceImagePreview bytes={packedImage} />
                        </div>
                      )
                    : null}
                  <TextField
                    aria-label={t('deviceGalleryImageName')}
                    disabled={!packedImage}
                    maxLength={64}
                    value={imageName}
                    variant="settings"
                    xstyle={styles.control}
                    onChange={event => setImageName(event.target.value)}
                  />
                  <Button
                    disabled={!packedImage || imageName.trim().length === 0 || phase === 'uploading'}
                    type="button"
                    variant="primary"
                    onClick={() => void upload()}
                  >
                    {phase === 'uploading' ? t('deviceGalleryUploading') : t('deviceGalleryUpload')}
                  </Button>
                </div>
              </div>

              {phase === 'converting'
                ? <GalleryUploadProgressBar progress={{ phase: 'preparing', sentBytes: 0, totalBytes: 0 }} />
                : uploadProgress
                  ? <GalleryUploadProgressBar progress={uploadProgress} />
                  : null}

              <div {...stylex.props(styles.slideshowRow)}>
                <div {...stylex.props(styles.slideshowCopy)}>
                  <span {...stylex.props(styles.label)}>{t('deviceGallerySlideshow')}</span>
                  <p {...stylex.props(styles.description)}>
                    {t(gallery.catalog.assets.length > 1
                      ? 'deviceGallerySlideshowDescription'
                      : 'deviceGallerySlideshowRequiresMultiple')}
                  </p>
                </div>
                <SelectField
                  aria-label={t('deviceGallerySlideshow')}
                  disabled={gallery.catalog.assets.length < 2 || phase === 'saving'}
                  value={gallery.catalog.slideshowIntervalSeconds === null
                    ? 'off'
                    : String(gallery.catalog.slideshowIntervalSeconds)}
                  variant="settings"
                  xstyle={styles.control}
                  onChange={event => void setSlideshow(event.target.value)}
                >
                  <option value="off">{t('deviceGallerySlideshowOff')}</option>
                  <option value="300">{t('deviceGallerySlideshowMinutes', { count: 5 })}</option>
                  <option value="900">{t('deviceGallerySlideshowMinutes', { count: 15 })}</option>
                  <option value="1800">{t('deviceGallerySlideshowMinutes', { count: 30 })}</option>
                  <option value="3600">{t('deviceGallerySlideshowMinutes', { count: 60 })}</option>
                </SelectField>
              </div>

              <div {...stylex.props(styles.assetList)}>
                {gallery.catalog.assets.length === 0
                  ? <p {...stylex.props(styles.emptyList)}>{t('deviceGalleryEmpty')}</p>
                  : gallery.catalog.assets.map((asset, index) => (
                      <div key={asset.id} {...stylex.props(styles.assetRow)}>
                        <div {...stylex.props(styles.assetCopy)}>
                          <span {...stylex.props(styles.assetName)}>{asset.name}</span>
                          <span {...stylex.props(styles.assetMeta)}>{t('deviceGalleryAssetMeta', { index: index + 1, size: Math.floor(asset.byteLength / 1024) })}</span>
                        </div>
                        <div {...stylex.props(styles.assetActions)}>
                          <Button aria-label={t('deviceGalleryMoveUp')} disabled={index === 0} type="button" variant="plain" xstyle={styles.iconButton} onClick={() => void move(index, -1)}>
                            <ArrowUp aria-hidden="true" size={14} />
                          </Button>
                          <Button aria-label={t('deviceGalleryMoveDown')} disabled={index + 1 === gallery.catalog.assets.length} type="button" variant="plain" xstyle={styles.iconButton} onClick={() => void move(index, 1)}>
                            <ArrowDown aria-hidden="true" size={14} />
                          </Button>
                          {pendingDelete === asset.id
                            ? <Button type="button" variant="plain" xstyle={styles.compactButton} onClick={() => setPendingDelete(null)}>{t('cancel')}</Button>
                            : null}
                          <Button aria-label={t('deviceGalleryDelete')} type="button" variant="plain" xstyle={styles.iconButton} onClick={() => void confirmDelete(asset)}>
                            <Trash2 aria-hidden="true" size={14} />
                            {pendingDelete === asset.id ? t('deviceGalleryConfirmDelete') : null}
                          </Button>
                        </div>
                      </div>
                    ))}
              </div>
            </>
          )
        : null}

      <Status variant={phase === 'error' ? 'error' : phase === 'success' ? 'success' : 'neutral'}>
        {t(galleryStatusKey(phase, enabled, gallery?.lastError ?? deviceError))}
      </Status>
    </section>
  )
}

function deviceAddressForDeviceId(deviceId: string): string {
  const normalized = deviceId.toLowerCase().replace(/[^a-z0-9-]/gu, '-')
  return `memorilo-${normalized}.local`
}

interface DeviceGalleryErrorBoundaryProps {
  readonly children: ReactNode
  readonly fallback: string
  readonly retry: string
}

interface DeviceGalleryErrorBoundaryState {
  readonly failed: boolean
}

export class DeviceGalleryErrorBoundary extends Component<
  DeviceGalleryErrorBoundaryProps,
  DeviceGalleryErrorBoundaryState
> {
  override state: DeviceGalleryErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): DeviceGalleryErrorBoundaryState {
    return { failed: true }
  }

  override render() {
    if (!this.state.failed)
      return this.props.children
    return (
      <section {...stylex.props(styles.root)}>
        <Status variant="error">{this.props.fallback}</Status>
        <Button
          type="button"
          variant="secondary"
          xstyle={styles.compactButton}
          onClick={() => this.setState({ failed: false })}
        >
          {this.props.retry}
        </Button>
      </section>
    )
  }
}

export function DeviceImageCropEditor({
  crop,
  disabled = false,
  source,
  sourceHeight,
  sourceWidth,
  onChange,
}: {
  readonly crop: DeviceImageCrop
  readonly disabled?: boolean
  readonly source: CanvasImageSource
  readonly sourceHeight: number
  readonly sourceWidth: number
  readonly onChange: (crop: DeviceImageCrop) => void
}) {
  const { t } = useTranslation('settings')
  const descriptionId = useId()
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ pointerId: number, x: number, y: number } | null>(null)
  const cropRef = useRef(crop)
  cropRef.current = crop
  let layout: DeviceImageCropLayout | null
  try {
    layout = deviceImageCropLayout(sourceWidth, sourceHeight, crop)
  }
  catch {
    layout = null
  }
  useEffect(() => {
    if (!layout)
      return
    const context = canvas.current?.getContext('2d', { alpha: false })
    if (!context)
      return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, deviceImageWidth, deviceImageHeight)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, layout.x, layout.y, layout.width, layout.height)
  }, [layout, source])
  if (!layout)
    return <p {...stylex.props(styles.cropHint)}>{t('deviceGalleryImagePreviewError')}</p>

  const update = (next: DeviceImageCrop): void => {
    cropRef.current = next
    onChange(next)
  }
  const move = (deltaX: number, deltaY: number): void => {
    update(moveDeviceImageCrop(cropRef.current, deltaX, deltaY, sourceWidth, sourceHeight))
  }
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled)
      return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || drag.current?.pointerId !== event.pointerId)
      return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0)
      return
    const deltaX = (event.clientX - drag.current.x) * deviceImageWidth / bounds.width
    const deltaY = (event.clientY - drag.current.y) * deviceImageHeight / bounds.height
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    move(deltaX, deltaY)
  }
  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== event.pointerId)
      return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled)
      return
    const distance = event.shiftKey ? 20 : 4
    const movements: Partial<Record<string, readonly [number, number]>> = {
      ArrowDown: [0, -distance],
      ArrowLeft: [distance, 0],
      ArrowRight: [-distance, 0],
      ArrowUp: [0, distance],
    }
    const movement = movements[event.key]
    if (!movement)
      return
    event.preventDefault()
    move(movement[0], movement[1])
  }

  return (
    <div {...stylex.props(styles.cropEditor)}>
      <div
        aria-describedby={descriptionId}
        aria-disabled={disabled}
        aria-label={t('deviceGalleryCrop')}
        role="application"
        tabIndex={disabled ? -1 : 0}
        {...stylex.props(styles.cropViewport)}
        onKeyDown={keyDown}
        onPointerCancel={pointerEnd}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
      >
        <canvas
          ref={canvas}
          aria-hidden="true"
          height={deviceImageHeight}
          width={deviceImageWidth}
          {...stylex.props(styles.cropCanvas)}
        />
        <span aria-hidden="true" {...stylex.props(styles.cropGuide)} />
      </div>
      <div {...stylex.props(styles.cropToolbar)}>
        <label {...stylex.props(styles.zoomControl)}>
          <span>{t('deviceGalleryZoom')}</span>
          <input
            aria-label={t('deviceGalleryZoom')}
            disabled={disabled}
            max="4"
            min="1"
            step="0.01"
            type="range"
            value={crop.zoom}
            {...stylex.props(styles.zoomSlider)}
            onChange={(event) => {
              update(normalizeDeviceImageCrop({ ...cropRef.current, zoom: Number(event.target.value) }, sourceWidth, sourceHeight))
            }}
          />
        </label>
        <Button
          disabled={disabled || (crop.zoom === 1 && crop.focusX === 0.5 && crop.focusY === 0.5)}
          type="button"
          variant="plain"
          xstyle={styles.compactButton}
          onClick={() => update(defaultDeviceImageCrop)}
        >
          {t('deviceGalleryResetCrop')}
        </Button>
      </div>
      <p id={descriptionId} {...stylex.props(styles.cropHint)}>{t('deviceGalleryCropHint')}</p>
    </div>
  )
}

export function GalleryUploadProgressBar({
  progress,
}: {
  readonly progress: GalleryUploadProgressView | { readonly phase: 'preparing', readonly sentBytes: 0, readonly totalBytes: 0 }
}) {
  const { t } = useTranslation('settings')
  const determinate = progress.phase === 'sending' && progress.totalBytes > 0
  const fraction = determinate ? Math.min(1, progress.sentBytes / progress.totalBytes) : 0
  const label = progress.phase === 'preparing'
    ? t('deviceGalleryProgressPreparing')
    : progress.phase === 'sending'
      ? t('deviceGalleryProgressUploading')
      : t('deviceGalleryProgressCommitting')
  return (
    <div {...stylex.props(styles.progressGroup)}>
      <div {...stylex.props(styles.progressCopy)}>
        <span>{label}</span>
        {determinate
          ? (
              <span>
                {`${Math.round(fraction * 100)}%`}
              </span>
            )
          : null}
      </div>
      <div
        aria-label={label}
        aria-valuemax={determinate ? progress.totalBytes : undefined}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuenow={determinate ? progress.sentBytes : undefined}
        role="progressbar"
        {...stylex.props(styles.progressTrack)}
      >
        <span
          style={determinate ? { transform: `scaleX(${fraction})` } : undefined}
          {...stylex.props(determinate ? styles.progressValue : styles.progressIndeterminate)}
        />
      </div>
    </div>
  )
}

function DeviceImagePreview({ bytes }: { bytes: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context)
      return
    context.putImageData(
      new ImageData(unpackDeviceImageRgba(bytes), deviceImageWidth, deviceImageHeight),
      0,
      0,
    )
  }, [bytes])
  return <canvas ref={canvas} height={deviceImageHeight} width={deviceImageWidth} {...stylex.props(styles.canvas)} />
}

function galleryStatusKey(
  phase: GalleryPhase,
  enabled: boolean,
  deviceError: string | null,
): string {
  if (!enabled)
    return 'deviceGalleryUnavailable'
  if (deviceError)
    return galleryDeviceErrorKey(deviceError)
  return {
    converting: 'deviceGalleryConverting',
    error: 'deviceGalleryError',
    idle: 'deviceGalleryIdle',
    loading: 'deviceGalleryLoading',
    ready: 'deviceGalleryReady',
    saving: 'deviceGallerySaving',
    success: 'deviceGallerySuccess',
    uploading: 'deviceGalleryUploading',
  }[phase]
}

function galleryDeviceErrorKey(error: string): string {
  return {
    'asset-not-found': 'deviceGalleryAssetNotFound',
    'capacity-exceeded': 'deviceGalleryCapacityExceeded',
    'invalid-asset-length': 'deviceGalleryInvalidAssetLength',
    'invalid-asset-name': 'deviceGalleryInvalidAssetName',
    'invalid-order': 'deviceGalleryInvalidOrder',
    'invalid-slideshow-interval': 'deviceGalleryInvalidSlideshowInterval',
    'storage-failure': 'deviceGalleryStorageFailure',
  }[error] ?? 'deviceGalleryDeviceError'
}

function galleryErrorMessage(error: unknown): string | null {
  if (error instanceof DeviceProvisioningError && typeof error.cause === 'string')
    return error.cause
  if (error instanceof GalleryDeviceError)
    return error.message
  return null
}
