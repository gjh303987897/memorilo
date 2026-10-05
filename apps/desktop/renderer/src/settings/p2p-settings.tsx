import type { DesktopP2pDiscoveredPeer, DesktopP2pLocalDevice, DesktopP2pPairedDevice, DesktopP2pPairingRequest, DesktopP2pStatus } from '@memorilo/desktop-api'
import type { ReactNode } from 'react'
import { Button, ButtonGroup, Status, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Check, Laptop, Radar, Save, ShieldCheck, Trash2, Wifi } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../shared/error-message'
import { p2pSettingsStyles as styles } from './p2p-settings.stylex'

function peerIdSummary(peerId: string): string {
  return peerId.length > 18 ? `${peerId.slice(0, 10)}…${peerId.slice(-6)}` : peerId
}

export function P2pSettings() {
  const { t } = useTranslation('settings')
  const available = typeof window.desktop !== 'undefined'
  const [devices, setDevices] = useState<readonly DesktopP2pPairedDevice[]>([])
  const [localDevice, setLocalDevice] = useState<DesktopP2pLocalDevice | null>(null)
  const [draftDeviceName, setDraftDeviceName] = useState('')
  const [nameDirty, setNameDirty] = useState(false)
  const [status, setStatus] = useState<DesktopP2pStatus | null>(null)
  const [peers, setPeers] = useState<readonly DesktopP2pDiscoveredPeer[]>([])
  const [requests, setRequests] = useState<readonly DesktopP2pPairingRequest[]>([])
  const [emojiByRequest, setEmojiByRequest] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!available)
      return
    const [nextLocalDevice, nextDevices, nextStatus, nextPeers, nextRequests] = await Promise.all([
      window.desktop.p2p.getLocalDevice(),
      window.desktop.p2p.listDevices(),
      window.desktop.p2p.getStatus(),
      window.desktop.p2p.listDiscoveredPeers(),
      window.desktop.p2p.getPairingRequests(),
    ])
    setDevices(nextDevices)
    setLocalDevice(nextLocalDevice)
    if (!nameDirty)
      setDraftDeviceName(nextLocalDevice.deviceName)
    setStatus(nextStatus)
    setPeers(nextPeers)
    setRequests(nextRequests)
  }, [available, nameDirty])

  const updateDeviceName = async () => {
    try {
      await window.desktop.p2p.updateDeviceName(draftDeviceName)
      setNameDirty(false)
      setMessage(t('p2pDeviceNameUpdated'))
      await reload()
    }
    catch (error) {
      setMessage(errorMessage(error))
    }
  }

  useEffect(() => {
    void reload()
    if (!available)
      return
    const timer = window.setInterval(() => void reload(), 1000)
    return () => window.clearInterval(timer)
  }, [available, reload])

  const enableDiscovery = async () => {
    try {
      await window.desktop.p2p.enableDiscovery()
      setMessage(t('p2pDiscoveryEnabled'))
      await reload()
    }
    catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const requestPairing = async (peer: DesktopP2pDiscoveredPeer) => {
    try {
      await window.desktop.p2p.requestPairing(peer.peerId)
      setMessage(t('p2pPairingRequested'))
    }
    catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const approvePairing = async (request: DesktopP2pPairingRequest) => {
    try {
      const emoji = await window.desktop.p2p.approvePairing(request.requestId)
      setEmojiByRequest(current => ({ ...current, [request.requestId]: emoji }))
      setMessage(t('p2pEmojiCheck'))
    }
    catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const confirmPairing = async (requestId: string) => {
    const emoji = emojiByRequest[requestId]
      ?? requests.find(request => request.requestId === requestId)?.emoji
    if (!emoji)
      return
    try {
      const device = await window.desktop.p2p.confirmPairing(requestId, emoji)
      if (device === null) {
        setMessage(t('p2pWaitingForConfirmation'))
        return
      }
      setEmojiByRequest((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      setMessage(t('p2pPairingCompleted'))
      await reload()
    }
    catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const stateLabel = status?.state === 'ready'
    ? t('p2pStateReady')
    : status?.state === 'starting'
      ? t('p2pStateStarting')
      : status?.state === 'error'
        ? t('p2pStateError')
        : t('p2pStateStopped')
  const pairingPeerIds = new Set(requests.map(request => request.peerId))
  const unpairedPeers = peers.filter(peer => !pairingPeerIds.has(peer.peerId))
  const nearbyDeviceCount = requests.length + unpairedPeers.length

  return (
    <div {...stylex.props(styles.root)} data-window-no-drag="">
      <section {...stylex.props(styles.majorSection)}>
        <div {...stylex.props(styles.surface)}>
          <section {...stylex.props(styles.identitySection)} aria-labelledby="p2p-local-device-heading">
            <div {...stylex.props(styles.deviceGlyph)}>
              <Laptop aria-hidden="true" size={22} strokeWidth={1.7} />
            </div>
            <div {...stylex.props(styles.identityCopy)}>
              <span {...stylex.props(styles.identityEyebrow)}>{t('p2pStatus')}</span>
              <div {...stylex.props(styles.identityHeadingLine)}>
                <h2 id="p2p-local-device-heading" {...stylex.props(styles.identityTitle)}>
                  {localDevice?.deviceName ?? t('p2pUnavailable')}
                </h2>
                <span {...stylex.props(styles.connectionState, status?.state === 'ready' && styles.connectionStateReady)}>
                  <span aria-hidden="true" {...stylex.props(styles.stateDot)} />
                  {stateLabel}
                </span>
              </div>
              <p {...stylex.props(styles.identityDescription)}>
                {t('p2pConnectionSummary', { count: status?.connectedPeers.length ?? 0 })}
              </p>
            </div>
          </section>

          <div {...stylex.props(styles.settingRow)}>
            <div {...stylex.props(styles.rowCopy)}>
              <label htmlFor="p2p-device-name" {...stylex.props(styles.rowLabel)}>{t('p2pDeviceName')}</label>
              <p {...stylex.props(styles.rowDescription)}>{t('p2pDeviceNameDescription')}</p>
            </div>
            <ButtonGroup xstyle={styles.nameEditor}>
              <TextField
                id="p2p-device-name"
                value={draftDeviceName}
                variant="settings"
                xstyle={styles.nameInput}
                maxLength={80}
                onChange={(event) => {
                  setDraftDeviceName(event.target.value)
                  setNameDirty(true)
                }}
              />
              <Button
                disabled={!available || !nameDirty || draftDeviceName.trim().length === 0}
                variant="secondary"
                xstyle={styles.compactButton}
                onClick={() => void updateDeviceName()}
              >
                <Save aria-hidden="true" size={14} strokeWidth={2} />
                {t('p2pSaveDeviceName')}
              </Button>
            </ButtonGroup>
          </div>

          <div {...stylex.props(styles.settingRow)}>
            <div {...stylex.props(styles.rowCopy)}>
              <span {...stylex.props(styles.rowLabel)}>{t('p2pDiscovery')}</span>
              <p {...stylex.props(styles.rowDescription)}>{t('p2pDiscoveryDescription')}</p>
            </div>
            <Button
              disabled={!available}
              variant="primary"
              xstyle={styles.compactButton}
              onClick={() => void enableDiscovery()}
            >
              <Radar aria-hidden="true" size={14} strokeWidth={2} />
              {t('p2pEnableDiscovery')}
            </Button>
          </div>

          <DeviceSection title={t('p2pNearbyDevices')} empty={nearbyDeviceCount === 0 ? t('p2pNoNearbyDevices') : null}>
            {unpairedPeers.map(peer => (
              <DeviceRow key={peer.peerId} name={peer.deviceName} detail={t('p2pDiscoveredOnNetwork')}>
                <Button variant="secondary" xstyle={styles.compactButton} onClick={() => void requestPairing(peer)}>
                  <ShieldCheck aria-hidden="true" size={14} strokeWidth={2} />
                  {t('p2pRequestPairing')}
                </Button>
              </DeviceRow>
            ))}
            {requests.map((request) => {
              const emoji = emojiByRequest[request.requestId] || request.emoji
              return (
                <DeviceRow key={request.requestId} name={request.deviceName} detail={emoji ? t('p2pCompareEmoji') : t('p2pPairingRequestPending')} stacked={Boolean(emoji)}>
                  {emoji
                    ? (
                        <div {...stylex.props(styles.emojiConfirmation)}>
                          <code {...stylex.props(styles.emojiCode)} aria-label={t('p2pPairingEmoji')}>{emoji}</code>
                          <Button variant="primary" xstyle={styles.compactButton} onClick={() => void confirmPairing(request.requestId)}>
                            <Check aria-hidden="true" size={14} strokeWidth={2} />
                            {t('p2pConfirmEmoji')}
                          </Button>
                        </div>
                      )
                    : (
                        <Button variant="primary" xstyle={styles.compactButton} onClick={() => void approvePairing(request)}>
                          <Check aria-hidden="true" size={14} strokeWidth={2} />
                          {t('p2pApprovePairing')}
                        </Button>
                      )}
                </DeviceRow>
              )
            })}
          </DeviceSection>

          <DeviceSection title={t('p2pPairedDevices')} empty={devices.length === 0 ? t('p2pNoPairedDevices') : null}>
            {devices.map(device => (
              <DeviceRow key={device.deviceId} name={device.deviceName} detail={peerIdSummary(device.peerId)}>
                <Button
                  aria-label={`${t('p2pRemove')} ${device.deviceName}`}
                  variant="plain"
                  xstyle={styles.removeButton}
                  onClick={() => void window.desktop.p2p.removeDevice(device.deviceId).then(reload)}
                >
                  <Trash2 aria-hidden="true" size={14} strokeWidth={2} />
                  {t('p2pRemove')}
                </Button>
              </DeviceRow>
            ))}
          </DeviceSection>
        </div>
      </section>

      {message
        ? (
            <Status xstyle={styles.feedback}>
              <Wifi aria-hidden="true" size={13} strokeWidth={2} />
              {message}
            </Status>
          )
        : null}
    </div>
  )
}

function DeviceSection({ children, empty, title }: { children: ReactNode, empty: string | null, title: string }) {
  return (
    <section {...stylex.props(styles.deviceSection)}>
      <h2 {...stylex.props(styles.sectionLabel)}>{title}</h2>
      <div {...stylex.props(styles.deviceList)}>
        {empty ? <p {...stylex.props(styles.emptyState)}>{empty}</p> : children}
      </div>
    </section>
  )
}

function DeviceRow({ children, detail, name, stacked = false }: { children: ReactNode, detail: string, name: string, stacked?: boolean }) {
  return (
    <div {...stylex.props(styles.deviceRow, stacked && styles.deviceRowStacked)}>
      <div {...stylex.props(styles.deviceCopy)}>
        <span {...stylex.props(styles.deviceName)}>{name}</span>
        <span {...stylex.props(styles.deviceDetail)}>{detail}</span>
      </div>
      {children}
    </div>
  )
}
