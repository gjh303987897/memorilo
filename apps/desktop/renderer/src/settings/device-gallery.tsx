import type { DesktopDeviceGalleryAsset, DesktopDeviceGalleryStatus } from '@memorilo/desktop-api'
import type { DeviceImageFit } from './device-image-conversion'
import type { DeviceProvisioningClient } from './device-provisioning-service'
import { Button, SelectField, Status, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Effect } from 'effect'
import { ArrowDown, ArrowUp, ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'
import { deviceGalleryStyles as styles } from './device-gallery.stylex'
import {
  convertDeviceImage,

  deviceImageHeight,
  deviceImageWidth,
  unpackDeviceImageRgba,
} from './device-image-conversion'

type GalleryPhase = 'converting' | 'error' | 'idle' | 'loading' | 'saving' | 'success' | 'uploading'

export function DeviceGallery({
  client,
  deviceId,
  enabled,
}: {
  client: DeviceProvisioningClient
  deviceId: string
  enabled: boolean
}) {
  const { t } = useTranslation('settings')
  const [address, setAddress] = useState('')
  const [fit, setFit] = useState<DeviceImageFit>('contain')
  const [gallery, setGallery] = useState<DesktopDeviceGalleryStatus | null>(null)
  const [phase, setPhase] = useState<GalleryPhase>('idle')
  const [packedImage, setPackedImage] = useState<Uint8Array | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [imageName, setImageName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const operation = useRef(0)

  useEffect(() => () => {
    operation.current += 1
  }, [])

  const target = { address: address.trim(), deviceId }
  const refresh = async (): Promise<DesktopDeviceGalleryStatus | null> => {
    if (!enabled || target.address.length === 0)
      return null
    const sequence = ++operation.current
    setPhase('loading')
    try {
      const next = await Effect.runPromise(client.loadGallery(target))
      if (operation.current !== sequence)
        return null
      setGallery(next)
      setPhase(next.lastError ? 'error' : 'idle')
      return next
    }
    catch {
      if (operation.current === sequence)
        setPhase('error')
      return null
    }
  }

  const waitForMutation = async (previousRevision: number): Promise<DesktopDeviceGalleryStatus> => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250))
      const next = await Effect.runPromise(client.loadGallery(target))
      if (next.mutationRevision > previousRevision) {
        if (next.lastError)
          throw new Error(next.lastError)
        return next
      }
    }
    throw new Error('gallery-mutation-timeout')
  }

  const chooseImage = async (
    file: File | null | undefined,
    imageFit: DeviceImageFit = fit,
  ): Promise<void> => {
    if (!file)
      return
    const sequence = ++operation.current
    setPhase('converting')
    try {
      const converted = await convertDeviceImage(file, imageFit)
      if (operation.current !== sequence)
        return
      setPackedImage(converted)
      setSourceFile(file)
      setImageName(Array.from(file.name).slice(0, 64).join(''))
      setPhase('idle')
    }
    catch {
      if (operation.current === sequence)
        setPhase('error')
    }
  }

  const upload = async (): Promise<void> => {
    if (!gallery || !packedImage || imageName.trim().length === 0)
      return
    const sequence = ++operation.current
    setPhase('uploading')
    try {
      await Effect.runPromise(client.uploadGalleryAsset({
        ...target,
        bytes: packedImage,
        createdAtUnixSeconds: Math.floor(Date.now() / 1000),
        name: imageName.trim(),
      }))
      const next = await waitForMutation(gallery.mutationRevision)
      if (operation.current !== sequence)
        return
      setGallery(next)
      setPackedImage(null)
      setSourceFile(null)
      setImageName('')
      setPhase('success')
    }
    catch {
      if (operation.current === sequence)
        setPhase('error')
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
      await Effect.runPromise(client.deleteGalleryAsset(target, asset.id))
      const next = await waitForMutation(gallery.mutationRevision)
      if (operation.current !== sequence)
        return
      setGallery(next)
      setPendingDelete(null)
      setPhase('success')
    }
    catch {
      if (operation.current === sequence)
        setPhase('error')
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
      await Effect.runPromise(client.reorderGallery(target, assets.map(candidate => candidate.id)))
      setGallery(await waitForMutation(previous.mutationRevision))
      setPhase('success')
    }
    catch {
      setGallery(previous)
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
      await Effect.runPromise(client.setGallerySlideshow(target, intervalSeconds))
      setGallery(await waitForMutation(previous.mutationRevision))
      setPhase('success')
    }
    catch {
      setGallery(previous)
      setPhase('error')
    }
  }

  const usedBytes = gallery?.catalog.assets.reduce((sum, asset) => sum + asset.byteLength, 0) ?? 0

  return (
    <section {...stylex.props(styles.root)} aria-labelledby="device-gallery-heading">
      <div {...stylex.props(styles.headingRow)}>
        <div>
          <h3 id="device-gallery-heading" {...stylex.props(styles.heading)}>{t('deviceGallery')}</h3>
          <p {...stylex.props(styles.description)}>{t('deviceGalleryDescription')}</p>
        </div>
        <Button
          disabled={!enabled || address.trim().length === 0 || phase === 'loading'}
          type="button"
          variant="secondary"
          xstyle={styles.compactButton}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" size={13} />
          {t('deviceGalleryConnect')}
        </Button>
      </div>

      <div {...stylex.props(styles.connectionRow)}>
        <TextField
          aria-label={t('deviceGalleryAddress')}
          placeholder="192.168.1.42"
          value={address}
          variant="settings"
          xstyle={styles.address}
          onChange={event => setAddress(event.target.value)}
        />
        <span {...stylex.props(styles.addressHint)}>{t('deviceGalleryAddressDescription')}</span>
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
                  {packedImage
                    ? <DeviceImagePreview bytes={packedImage} />
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
                  <SelectField
                    aria-label={t('deviceGalleryFit')}
                    value={fit}
                    variant="settings"
                    onChange={(event) => {
                      const nextFit = event.target.value as DeviceImageFit
                      setFit(nextFit)
                      if (sourceFile)
                        void chooseImage(sourceFile, nextFit)
                    }}
                  >
                    <option value="contain">{t('deviceGalleryContain')}</option>
                    <option value="cover">{t('deviceGalleryCover')}</option>
                  </SelectField>
                  <TextField
                    aria-label={t('deviceGalleryImageName')}
                    disabled={!packedImage}
                    maxLength={64}
                    value={imageName}
                    variant="settings"
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

              <div {...stylex.props(styles.slideshowRow)}>
                <div>
                  <span {...stylex.props(styles.label)}>{t('deviceGallerySlideshow')}</span>
                  <p {...stylex.props(styles.description)}>{t('deviceGallerySlideshowDescription')}</p>
                </div>
                <SelectField
                  aria-label={t('deviceGallerySlideshow')}
                  value={gallery.catalog.slideshowIntervalSeconds === null
                    ? 'off'
                    : String(gallery.catalog.slideshowIntervalSeconds)}
                  variant="settings"
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
        {t(galleryStatusKey(phase, enabled, gallery?.lastError ?? null))}
      </Status>
    </section>
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
    return 'deviceGalleryTokenRequired'
  if (deviceError)
    return 'deviceGalleryDeviceError'
  return {
    converting: 'deviceGalleryConverting',
    error: 'deviceGalleryError',
    idle: 'deviceGalleryIdle',
    loading: 'deviceGalleryLoading',
    saving: 'deviceGallerySaving',
    success: 'deviceGallerySuccess',
    uploading: 'deviceGalleryUploading',
  }[phase]
}
