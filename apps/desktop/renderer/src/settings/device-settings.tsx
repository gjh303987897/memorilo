import type { DesktopProvisioningDevice, DesktopProvisioningPairingRequest } from '@memorilo/desktop-api'
import type { DeviceConfigPatch, PublicConfigEnvelope } from '@memorilo/device-provisioning'
import type { DeviceProvisioningClient, DeviceProvisioningSession } from './device-provisioning-service'
import { Button, SelectField, Status, Switch, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Effect } from 'effect'
import { Bluetooth, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DeviceGallery } from './device-gallery'
import {
  createDeviceProvisioningService,
  DeviceProvisioningError,
} from './device-provisioning-service'
import { deviceSettingsStyles as styles } from './device-settings.stylex'

type ProvisioningPhase
  = | 'applying'
    | 'connecting'
    | 'error'
    | 'idle'
    | 'pairing'
    | 'ready'
    | 'scanning'
    | 'selecting'
    | 'success'
    | 'timeout'

interface DeviceFormState {
  clearWifiPassword: boolean
  deviceName: string
  idleSleepSeconds: string
  timezone: string
  wifiPassword: string
  wifiSsid: string
  weatherEnabled: boolean
  weatherLocation: string
  weatherLatitude: string
  weatherLongitude: string
  todoSyncView: 'today' | 'all'
}

type PendingLocalManagementChange
  = | { readonly kind: 'clear' }
    | { readonly kind: 'replace', readonly token: string }

const emptyForm: DeviceFormState = {
  clearWifiPassword: false,
  deviceName: '',
  idleSleepSeconds: '600',
  timezone: 'UTC',
  wifiPassword: '',
  wifiSsid: '',
  weatherEnabled: false,
  weatherLocation: '',
  weatherLatitude: '0',
  weatherLongitude: '0',
  todoSyncView: 'today',
}

export function DeviceSettings({ client }: { client?: DeviceProvisioningClient }) {
  const { t } = useTranslation('settings')
  const [service] = useState(() => client ?? createDeviceProvisioningService())
  const [phase, setPhase] = useState<ProvisioningPhase>('idle')
  const [devices, setDevices] = useState<readonly DesktopProvisioningDevice[]>([])
  const [pairing, setPairing] = useState<DesktopProvisioningPairingRequest | null>(null)
  const [pairingPin, setPairingPin] = useState('')
  const [connection, setConnection] = useState<DeviceProvisioningSession | null>(null)
  const [bleConnected, setBleConnected] = useState(false)
  const [form, setForm] = useState<DeviceFormState>(emptyForm)
  const [localManagementCredentialStored, setLocalManagementCredentialStored] = useState(false)
  const [pendingLocalManagement, setPendingLocalManagement] = useState<PendingLocalManagementChange | null>(null)
  const [errorCode, setErrorCode] = useState<DeviceProvisioningError['code'] | 'invalid-config' | null>(null)
  const operation = useRef(0)
  const scanControllerRef = useRef<AbortController | null>(null)
  const connectionRef = useRef<DeviceProvisioningSession | null>(null)
  const unsubscribeDisconnectRef = useRef<(() => void) | null>(null)
  const pairingRef = useRef<DesktopProvisioningPairingRequest | null>(null)

  useEffect(() => {
    const unsubscribeDevices = service.subscribeDevices((nextDevices) => {
      setDevices(nextDevices)
      setPhase(current => current === 'scanning' || current === 'selecting' ? 'selecting' : current)
    })
    const unsubscribePairing = service.subscribePairing((request) => {
      pairingRef.current = request
      setPairing(request)
      setPairingPin('')
      setPhase('pairing')
    })
    return () => {
      operation.current += 1
      scanControllerRef.current?.abort()
      scanControllerRef.current = null
      unsubscribeDevices()
      unsubscribePairing()
      const pendingPairing = pairingRef.current
      if (pendingPairing) {
        void Effect.runPromise(service.respondToPairing({
          confirmed: false,
          requestId: pendingPairing.requestId,
        })).catch(() => undefined)
      }
      void Effect.runPromise(service.cancelSelection()).catch(() => undefined)
      const activeConnection = connectionRef.current
      connectionRef.current = null
      unsubscribeDisconnectRef.current?.()
      unsubscribeDisconnectRef.current = null
      if (activeConnection)
        void Effect.runPromise(activeConnection.close())
    }
  }, [service])

  const startScan = async (): Promise<void> => {
    const currentOperation = ++operation.current
    scanControllerRef.current?.abort()
    const controller = new AbortController()
    scanControllerRef.current = controller
    unsubscribeDisconnectRef.current?.()
    unsubscribeDisconnectRef.current = null
    const previousConnection = connectionRef.current
    connectionRef.current = null
    if (previousConnection)
      await Effect.runPromise(previousConnection.close())
    if (operation.current !== currentOperation)
      return
    setConnection(null)
    setBleConnected(false)
    setDevices([])
    setPairing(null)
    pairingRef.current = null
    setErrorCode(null)
    setPhase('scanning')
    try {
      const nextConnection = await Effect.runPromise(service.connect(), { signal: controller.signal })
      if (operation.current !== currentOperation) {
        await Effect.runPromise(nextConnection.close())
        return
      }
      connectionRef.current = nextConnection
      const credentialStored = await Effect.runPromise(service.hasLocalManagementToken(nextConnection.device.info.deviceId), { signal: controller.signal })
      await Effect.runPromise(service.saveTodoTarget(
        nextConnection.device.info.deviceId,
        deviceAddressForDeviceId(nextConnection.device.info.deviceId),
      ), { signal: controller.signal })
      setConnection(nextConnection)
      setBleConnected(nextConnection.connected)
      unsubscribeDisconnectRef.current = nextConnection.subscribeDisconnected(() => {
        setBleConnected(false)
      })
      setForm(formFromConfig(nextConnection.device.config))
      setLocalManagementCredentialStored(credentialStored)
      setPendingLocalManagement(null)
      setPhase('ready')
    }
    catch (error) {
      if (operation.current !== currentOperation)
        return
      setDevices([])
      handleError(error, setErrorCode, setPhase)
    }
    finally {
      if (scanControllerRef.current === controller)
        scanControllerRef.current = null
    }
  }

  const selectDevice = async (device: DesktopProvisioningDevice): Promise<void> => {
    setPhase('connecting')
    try {
      await Effect.runPromise(service.selectDevice(device))
    }
    catch (error) {
      handleError(error, setErrorCode, setPhase)
    }
  }

  const answerPairing = async (confirmed: boolean): Promise<void> => {
    if (!pairing)
      return
    const pin = pairing.pairingKind === 'providePin' ? pairingPin : undefined
    if (confirmed && pairing.pairingKind === 'providePin' && !/^\d{6}$/u.test(pairingPin)) {
      setErrorCode('invalid-config')
      setPhase('error')
      return
    }
    try {
      await Effect.runPromise(service.respondToPairing({ confirmed, pin, requestId: pairing.requestId }))
      pairingRef.current = null
      setPairing(null)
      setPhase(confirmed ? 'connecting' : 'idle')
      if (!confirmed) {
        operation.current += 1
        scanControllerRef.current?.abort()
        scanControllerRef.current = null
      }
    }
    catch (error) {
      handleError(error, setErrorCode, setPhase)
    }
  }

  const cancelScan = async (): Promise<void> => {
    operation.current += 1
    scanControllerRef.current?.abort()
    scanControllerRef.current = null
    unsubscribeDisconnectRef.current?.()
    unsubscribeDisconnectRef.current = null
    const activeConnection = connectionRef.current
    connectionRef.current = null
    if (activeConnection)
      await Effect.runPromise(activeConnection.close())
    setBleConnected(false)
    const pendingPairing = pairingRef.current
    try {
      if (pendingPairing) {
        await Effect.runPromise(service.respondToPairing({
          confirmed: false,
          requestId: pendingPairing.requestId,
        }))
      }
      else {
        await Effect.runPromise(service.cancelSelection())
      }
    }
    catch {
      // The platform may already have closed the chooser while cancellation was in flight.
    }
    pairingRef.current = null
    setPairing(null)
    setDevices([])
    setPhase('idle')
  }

  const applyConfiguration = async (): Promise<void> => {
    if (!connection || !connection.connected)
      return
    const idleSleepSeconds = Number(form.idleSleepSeconds)
    const latitude = Number(form.weatherLatitude)
    const longitude = Number(form.weatherLongitude)
    if (!Number.isSafeInteger(idleSleepSeconds) || idleSleepSeconds < 30 || idleSleepSeconds > 86_400
      || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setErrorCode('invalid-config')
      setPhase('error')
      return
    }
    let managementToken = pendingLocalManagement?.kind === 'replace' ? pendingLocalManagement.token : undefined
    const patch: DeviceConfigPatch = {
      deviceName: form.deviceName.trim(),
      idleSleepSeconds,
      timezone: form.timezone.trim(),
      ...(managementToken ? { localManagement: { token: managementToken } } : {}),
      wifi: {
        ...(form.clearWifiPassword ? { clearPassword: true } : {}),
        ...(form.wifiPassword.length > 0 ? { password: form.wifiPassword } : {}),
        ssid: form.wifiSsid.trim(),
      },
      weather: {
        enabled: form.weatherEnabled,
        locationName: form.weatherLocation.trim(),
        latitudeE6: Math.round(latitude * 1_000_000),
        longitudeE6: Math.round(longitude * 1_000_000),
      },
      todoSync: {
        enabled: true,
        view: form.todoSyncView,
      },
    }
    if (patch.deviceName?.length === 0 || patch.timezone?.length === 0) {
      setErrorCode('invalid-config')
      setPhase('error')
      return
    }
    setErrorCode(null)
    setPhase('applying')
    try {
      if (!managementToken && !localManagementCredentialStored) {
        managementToken = await Effect.runPromise(service.generateLocalManagementToken())
        patch.localManagement = { token: managementToken }
      }
      await Effect.runPromise(connection.apply(patch))
      if (managementToken) {
        await Effect.runPromise(service.saveLocalManagementToken(
          connection.device.info.deviceId,
          managementToken,
        ))
        setLocalManagementCredentialStored(true)
      }
      setForm(formFromConfig(connection.device.config))
      setPendingLocalManagement(null)
      setPhase('success')
    }
    catch (error) {
      handleError(error, setErrorCode, setPhase)
    }
  }

  const disconnect = async (): Promise<void> => {
    operation.current += 1
    unsubscribeDisconnectRef.current?.()
    unsubscribeDisconnectRef.current = null
    setBleConnected(false)
    const activeConnection = connectionRef.current
    connectionRef.current = null
    setConnection(null)
    setLocalManagementCredentialStored(false)
    setPendingLocalManagement(null)
    if (activeConnection)
      await Effect.runPromise(activeConnection.close())
    setPhase('idle')
  }

  const forget = async (): Promise<void> => {
    operation.current += 1
    unsubscribeDisconnectRef.current?.()
    unsubscribeDisconnectRef.current = null
    setBleConnected(false)
    const activeConnection = connectionRef.current
    connectionRef.current = null
    setConnection(null)
    try {
      if (activeConnection) {
        await Effect.runPromise(activeConnection.forget())
        await Effect.runPromise(service.clearLocalManagementToken(activeConnection.device.info.deviceId))
      }
      setLocalManagementCredentialStored(false)
      setPendingLocalManagement(null)
      setPhase('idle')
    }
    catch (error) {
      handleError(error, setErrorCode, setPhase)
    }
  }

  const statusKey = statusTranslationKey(phase, errorCode)
  const canCancel = phase === 'connecting' || phase === 'pairing' || phase === 'scanning' || phase === 'selecting'
  const scanDisabled = phase === 'applying' || canCancel

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.surface)}>
        <div {...stylex.props(styles.summary)}>
          <span {...stylex.props(styles.glyph)}><Bluetooth aria-hidden="true" size={19} strokeWidth={1.8} /></span>
          <div {...stylex.props(styles.summaryCopy)}>
            <h2 {...stylex.props(styles.summaryTitle)}>
              {connection?.device.name ?? t('deviceSetupTitle')}
            </h2>
            <p {...stylex.props(styles.summaryDetail)}>
              {connection
                ? bleConnected
                  ? t('deviceFirmwareSummary', { version: connection.device.info.firmwareVersion })
                  : t('deviceRemoteDisconnected')
                : t('deviceSetupSummary')}
            </p>
          </div>
          {connection && bleConnected
            ? null
            : (
                <Button disabled={scanDisabled} variant="primary" xstyle={styles.compactButton} onClick={() => void startScan()}>
                  {t('deviceScan')}
                </Button>
              )}
        </div>

        {devices.length > 0 && !connection
          ? (
              <section {...stylex.props(styles.section)} aria-labelledby="device-results-heading">
                <h3 id="device-results-heading" {...stylex.props(styles.sectionTitle)}>{t('deviceAvailable')}</h3>
                <div {...stylex.props(styles.deviceList)}>
                  {devices.map(device => (
                    <Button
                      key={device.deviceId}
                      variant="plain"
                      xstyle={styles.deviceButton}
                      disabled={phase !== 'selecting'}
                      onClick={() => void selectDevice(device)}
                    >
                      <span {...stylex.props(styles.deviceName)}>{device.deviceName || t('deviceUnnamed')}</span>
                      <span {...stylex.props(styles.deviceAction)}>
                        {t('deviceSelect')}
                        <ChevronRight aria-hidden="true" size={13} />
                      </span>
                    </Button>
                  ))}
                </div>
              </section>
            )
          : null}

        {pairing
          ? (
              <section {...stylex.props(styles.section)} aria-labelledby="device-pairing-heading">
                <h3 id="device-pairing-heading" {...stylex.props(styles.sectionTitle)}>{t('devicePairing')}</h3>
                <div {...stylex.props(styles.pairing)}>
                  <p {...stylex.props(styles.description)}>{t(pairingDescriptionKey(pairing.pairingKind))}</p>
                  {pairing.pairingKind === 'providePin'
                    ? (
                        <TextField
                          autoFocus
                          aria-label={t('devicePairingPin')}
                          inputMode="numeric"
                          maxLength={6}
                          pattern="[0-9]{6}"
                          placeholder="000000"
                          value={pairingPin}
                          variant="settings"
                          xstyle={styles.pairingInput}
                          onChange={event => setPairingPin(event.target.value.replace(/\D/gu, '').slice(0, 6))}
                        />
                      )
                    : pairing.pin
                      ? <code {...stylex.props(styles.pairingCode)}>{pairing.pin}</code>
                      : null}
                  <div {...stylex.props(styles.actions)}>
                    <Button variant="secondary" xstyle={styles.compactButton} onClick={() => void answerPairing(false)}>{t('cancel')}</Button>
                    <Button
                      disabled={pairing.pairingKind === 'providePin' && pairingPin.length !== 6}
                      variant="primary"
                      xstyle={styles.compactButton}
                      onClick={() => void answerPairing(true)}
                    >
                      {t('devicePair')}
                    </Button>
                  </div>
                </div>
              </section>
            )
          : null}

        {connection
          ? (
              <form
                {...stylex.props(styles.form)}
                onSubmit={(event) => {
                  event.preventDefault()
                  void applyConfiguration()
                }}
              >
                <DeviceTextRow
                  description={t('deviceNameDescription')}
                  id="device-name"
                  label={t('deviceName')}
                  value={form.deviceName}
                  onChange={deviceName => setForm(current => ({ ...current, deviceName }))}
                />
                <DeviceTextRow
                  description={t('deviceWeatherDescription')}
                  id="device-weather-location"
                  label={t('deviceWeatherLocation')}
                  value={form.weatherLocation}
                  onChange={weatherLocation => setForm(current => ({ ...current, weatherLocation }))}
                />
                <div {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.rowCopy)}>
                    <label htmlFor="device-weather-enabled" {...stylex.props(styles.label)}>{t('deviceWeather')}</label>
                    <p {...stylex.props(styles.description)}>{t('deviceWeatherDescription')}</p>
                  </div>
                  <Switch id="device-weather-enabled" checked={form.weatherEnabled} variant="compact" onCheckedChange={weatherEnabled => setForm(current => ({ ...current, weatherEnabled }))} />
                </div>
                <DeviceTextRow description={t('deviceWeatherCoordinates')} id="device-weather-latitude" label={t('deviceWeatherLatitude')} type="number" value={form.weatherLatitude} onChange={weatherLatitude => setForm(current => ({ ...current, weatherLatitude }))} />
                <DeviceTextRow description={t('deviceWeatherCoordinates')} id="device-weather-longitude" label={t('deviceWeatherLongitude')} type="number" value={form.weatherLongitude} onChange={weatherLongitude => setForm(current => ({ ...current, weatherLongitude }))} />
                <div {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.rowCopy)}>
                    <label htmlFor="device-todo-sync-view" {...stylex.props(styles.label)}>{t('deviceTodoSyncView')}</label>
                    <p {...stylex.props(styles.description)}>{t('deviceTodoSyncViewDescription')}</p>
                  </div>
                  <select id="device-todo-sync-view" value={form.todoSyncView} onChange={event => setForm(current => ({ ...current, todoSyncView: event.target.value as 'today' | 'all' }))}>
                    <option value="today">{t('deviceTodoSyncToday')}</option>
                    <option value="all">{t('deviceTodoSyncAll')}</option>
                  </select>
                </div>
                <DeviceTextRow
                  description={t('deviceWifiSsidDescription')}
                  id="device-wifi-ssid"
                  label={t('deviceWifiSsid')}
                  value={form.wifiSsid}
                  onChange={wifiSsid => setForm(current => ({ ...current, wifiSsid }))}
                />
                <DeviceTextRow
                  description={connection.device.config.wifiPasswordIsSet
                    ? t('deviceWifiPasswordSavedDescription')
                    : t('deviceWifiPasswordDescription')}
                  disabled={form.clearWifiPassword}
                  id="device-wifi-password"
                  label={t('deviceWifiPassword')}
                  type="password"
                  value={form.wifiPassword}
                  onChange={wifiPassword => setForm(current => ({ ...current, wifiPassword }))}
                />
                {connection.device.config.wifiPasswordIsSet
                  ? (
                      <div {...stylex.props(styles.row)}>
                        <div {...stylex.props(styles.rowCopy)}>
                          <span {...stylex.props(styles.label)}>{t('deviceClearWifiPassword')}</span>
                          <p {...stylex.props(styles.description)}>{t('deviceClearWifiPasswordDescription')}</p>
                        </div>
                        <Switch
                          aria-label={t('deviceClearWifiPassword')}
                          checked={form.clearWifiPassword}
                          disabled={phase === 'applying'}
                          variant="compact"
                          xstyle={styles.switchControl}
                          onCheckedChange={clearWifiPassword => setForm(current => ({
                            ...current,
                            clearWifiPassword,
                            ...(clearWifiPassword ? { wifiPassword: '' } : {}),
                          }))}
                        />
                      </div>
                    )
                  : null}
                <DeviceGallery
                  client={service}
                  deviceId={connection.device.info.deviceId}
                  enabled={localManagementCredentialStored && pendingLocalManagement?.kind !== 'clear'}
                />
                <div {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.rowCopy)}>
                    <label htmlFor="device-timezone" {...stylex.props(styles.label)}>{t('deviceTimezone')}</label>
                    <p {...stylex.props(styles.description)}>{t('deviceTimezoneDescription')}</p>
                  </div>
                  <SelectField
                    id="device-timezone"
                    value={form.timezone}
                    variant="settings"
                    xstyle={styles.control}
                    onChange={event => setForm(current => ({ ...current, timezone: event.target.value }))}
                  >
                    {Intl.supportedValuesOf('timeZone').map(timeZone => <option key={timeZone} value={timeZone}>{timeZone}</option>)}
                  </SelectField>
                </div>
                <DeviceTextRow
                  description={t('deviceIdleSleepDescription')}
                  id="device-idle-sleep"
                  label={t('deviceIdleSleep')}
                  max={86_400}
                  min={30}
                  type="number"
                  value={form.idleSleepSeconds}
                  onChange={idleSleepSeconds => setForm(current => ({ ...current, idleSleepSeconds }))}
                />
                <div {...stylex.props(styles.footer)}>
                  <div {...stylex.props(styles.footerGroup)}>
                    <Button variant="secondary" xstyle={styles.compactButton} onClick={() => void disconnect()}>{t('deviceDisconnect')}</Button>
                    <Button variant="plain" xstyle={styles.compactButton} onClick={() => void forget()}>{t('deviceForget')}</Button>
                  </div>
                  <Button disabled={!bleConnected || phase === 'applying'} type="submit" variant="primary" xstyle={styles.compactButton}>
                    {phase === 'applying' ? t('deviceApplying') : t('deviceApply')}
                  </Button>
                </div>
              </form>
            )
          : null}
      </div>

      <Status
        variant={phase === 'error' || phase === 'timeout' ? 'error' : phase === 'success' ? 'success' : 'neutral'}
        xstyle={styles.status}
      >
        {t(statusKey)}
        {canCancel
          ? <Button variant="plain" xstyle={styles.compactButton} onClick={() => void cancelScan()}>{t('cancel')}</Button>
          : null}
      </Status>
    </div>
  )
}

function DeviceTextRow({
  description,
  disabled = false,
  id,
  label,
  max,
  min,
  onChange,
  type = 'text',
  value,
}: {
  description: string
  disabled?: boolean
  id: string
  label: string
  max?: number
  min?: number
  onChange: (value: string) => void
  type?: 'number' | 'password' | 'text'
  value: string
}) {
  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.rowCopy)}>
        <label htmlFor={id} {...stylex.props(styles.label)}>{label}</label>
        <p {...stylex.props(styles.description)}>{description}</p>
      </div>
      <TextField
        disabled={disabled}
        id={id}
        max={max}
        min={min}
        type={type}
        value={value}
        variant="settings"
        xstyle={styles.control}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  )
}

function formFromConfig(config: PublicConfigEnvelope): DeviceFormState {
  const supportedTimeZones = new Set(Intl.supportedValuesOf('timeZone'))
  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const timezone = supportedTimeZones.has(config.timezone)
    ? config.timezone
    : supportedTimeZones.has(systemTimeZone) ? systemTimeZone : 'UTC'
  return {
    clearWifiPassword: false,
    deviceName: config.deviceName,
    idleSleepSeconds: String(config.idleSleepSeconds),
    timezone,
    wifiPassword: '',
    wifiSsid: config.wifiSsid ?? '',
    weatherEnabled: config.weather?.enabled ?? false,
    weatherLocation: config.weather?.locationName ?? '',
    weatherLatitude: String((config.weather?.latitudeE6 ?? 0) / 1_000_000),
    weatherLongitude: String((config.weather?.longitudeE6 ?? 0) / 1_000_000),
    todoSyncView: config.todoSyncView,
  }
}

function handleError(
  error: unknown,
  setErrorCode: (code: DeviceProvisioningError['code']) => void,
  setPhase: (phase: ProvisioningPhase) => void,
): void {
  const code = error instanceof DeviceProvisioningError ? error.code : 'connection-failed'
  setErrorCode(code)
  setPhase(code === 'timeout' ? 'timeout' : 'error')
}

function pairingDescriptionKey(kind: DesktopProvisioningPairingRequest['pairingKind']): string {
  if (kind === 'providePin')
    return 'devicePairingProvidePin'
  if (kind === 'confirmPin')
    return 'devicePairingConfirmPin'
  return 'devicePairingConfirm'
}

function statusTranslationKey(
  phase: ProvisioningPhase,
  errorCode: DeviceProvisioningError['code'] | 'invalid-config' | null,
): string {
  if (phase === 'error') {
    if (errorCode === 'bluetooth-unavailable')
      return 'deviceStatusBluetoothUnavailable'
    if (errorCode === 'apply-rejected')
      return 'deviceStatusApplyRejected'
    if (errorCode === 'protocol-error')
      return 'deviceStatusProtocolError'
    if (errorCode === 'invalid-config')
      return 'deviceStatusInvalidConfig'
    if (errorCode === 'secure-storage')
      return 'deviceStatusSecureStorage'
    if (errorCode === 'local-management')
      return 'deviceStatusLocalManagement'
    return 'deviceStatusError'
  }
  return {
    applying: 'deviceStatusApplying',
    connecting: 'deviceStatusConnecting',
    error: 'deviceStatusError',
    idle: 'deviceStatusIdle',
    pairing: 'deviceStatusPairing',
    ready: 'deviceStatusReady',
    scanning: 'deviceStatusScanning',
    selecting: 'deviceStatusSelecting',
    success: 'deviceStatusSuccess',
    timeout: 'deviceStatusTimeout',
  }[phase]
}

function deviceAddressForDeviceId(deviceId: string): string {
  const normalized = deviceId.toLowerCase().replace(/[^a-z0-9-]/gu, '-')
  return `memorilo-${normalized}.local`
}
