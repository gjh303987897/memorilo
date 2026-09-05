import type { DesktopDeviceTodoPushStatus, DesktopDeviceTodoTargetState, DesktopProvisioningDevice, DesktopProvisioningPairingRequest } from '@memorilo/desktop-api'
import type { DeviceConfigPatch, PublicConfigEnvelope } from '@memorilo/device-provisioning'
import type { DeviceProvisioningClient, DeviceProvisioningSession } from './device-provisioning-service'
import { Button, Status, Switch, TextField } from '@memorilo/ui'
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
  almanacNote: string
  almanacSource: string
  todoSyncEnabled: boolean
  todoLanAddress: string
  todoSyncUrl: string
  todoSyncToken: string
  clearTodoSyncToken: boolean
  todoSyncPollIntervalSeconds: string
  todoSyncView: 'today' | 'all'
  todoSyncMqttBrokerUrl: string
  todoSyncMqttTopic: string
  todoSyncMqttUsername: string
  todoSyncMqttPassword: string
  clearTodoSyncMqttPassword: boolean
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
  almanacNote: '',
  almanacSource: '',
  todoSyncEnabled: false,
  todoLanAddress: '',
  todoSyncUrl: '',
  todoSyncToken: '',
  clearTodoSyncToken: false,
  todoSyncPollIntervalSeconds: '900',
  todoSyncView: 'today',
  todoSyncMqttBrokerUrl: '',
  todoSyncMqttTopic: '',
  todoSyncMqttUsername: '',
  todoSyncMqttPassword: '',
  clearTodoSyncMqttPassword: false,
}

export function DeviceSettings({ client }: { client?: DeviceProvisioningClient }) {
  const { t } = useTranslation('settings')
  const [service] = useState(() => client ?? createDeviceProvisioningService())
  const [phase, setPhase] = useState<ProvisioningPhase>('idle')
  const [devices, setDevices] = useState<readonly DesktopProvisioningDevice[]>([])
  const [pairing, setPairing] = useState<DesktopProvisioningPairingRequest | null>(null)
  const [pairingPin, setPairingPin] = useState('')
  const [connection, setConnection] = useState<DeviceProvisioningSession | null>(null)
  const [form, setForm] = useState<DeviceFormState>(emptyForm)
  const [localManagementCredentialStored, setLocalManagementCredentialStored] = useState(false)
  const [pendingLocalManagement, setPendingLocalManagement] = useState<PendingLocalManagementChange | null>(null)
  const [todoPushStatus, setTodoPushStatus] = useState<DesktopDeviceTodoPushStatus | null>(null)
  const [errorCode, setErrorCode] = useState<DeviceProvisioningError['code'] | 'invalid-config' | null>(null)
  const operation = useRef(0)
  const connectionRef = useRef<DeviceProvisioningSession | null>(null)
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
      if (activeConnection)
        void Effect.runPromise(activeConnection.close())
    }
  }, [service])

  const startScan = async (): Promise<void> => {
    const currentOperation = ++operation.current
    setDevices([])
    setPairing(null)
    pairingRef.current = null
    setErrorCode(null)
    setPhase('scanning')
    try {
      const nextConnection = await Effect.runPromise(service.connect())
      if (operation.current !== currentOperation) {
        await Effect.runPromise(nextConnection.close())
        return
      }
      let credentialStored: boolean
      try {
        credentialStored = await Effect.runPromise(
          service.hasLocalManagementToken(nextConnection.device.info.deviceId),
        )
      }
      catch (error) {
        await Effect.runPromise(nextConnection.close())
        throw error
      }
      let todoTarget: DesktopDeviceTodoTargetState = { status: null, target: null }
      try {
        todoTarget = await Effect.runPromise(service.loadTodoTarget(nextConnection.device.info.deviceId))
      }
      catch {
        todoTarget = { status: null, target: null }
      }
      connectionRef.current = nextConnection
      setConnection(nextConnection)
      setForm({ ...formFromConfig(nextConnection.device.config), todoLanAddress: todoTarget.target?.address ?? '' })
      setTodoPushStatus(todoTarget.status)
      setLocalManagementCredentialStored(credentialStored)
      setPendingLocalManagement(null)
      setPhase('ready')
    }
    catch (error) {
      if (operation.current !== currentOperation)
        return
      handleError(error, setErrorCode, setPhase)
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
      if (!confirmed)
        operation.current += 1
    }
    catch (error) {
      handleError(error, setErrorCode, setPhase)
    }
  }

  const cancelScan = async (): Promise<void> => {
    operation.current += 1
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
    if (!connection)
      return
    const idleSleepSeconds = Number(form.idleSleepSeconds)
    const latitude = Number(form.weatherLatitude)
    const longitude = Number(form.weatherLongitude)
    const todoSyncPollIntervalSeconds = Number(form.todoSyncPollIntervalSeconds)
    if (!Number.isSafeInteger(idleSleepSeconds) || idleSleepSeconds < 30 || idleSleepSeconds > 86_400
      || !Number.isSafeInteger(todoSyncPollIntervalSeconds) || todoSyncPollIntervalSeconds < 60 || todoSyncPollIntervalSeconds > 86_400
      || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setErrorCode('invalid-config')
      setPhase('error')
      return
    }
    if (form.todoLanAddress.trim().length > 0 && !isPrivateDeviceAddress(form.todoLanAddress.trim())) {
      setErrorCode('invalid-config')
      setPhase('error')
      return
    }
    const patch: DeviceConfigPatch = {
      deviceName: form.deviceName.trim(),
      idleSleepSeconds,
      timezone: form.timezone.trim(),
      ...(pendingLocalManagement === null
        ? {}
        : {
            localManagement: pendingLocalManagement.kind === 'clear'
              ? { clearToken: true }
              : { token: pendingLocalManagement.token },
          }),
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
      almanac: { note: form.almanacNote.trim(), source: form.almanacSource.trim() },
      todoSync: {
        enabled: form.todoSyncEnabled,
        httpsBaseUrl: form.todoSyncUrl.trim(),
        ...(form.clearTodoSyncToken ? { clearDeviceToken: true } : form.todoSyncToken.length > 0 ? { deviceToken: form.todoSyncToken } : {}),
        pollIntervalSeconds: todoSyncPollIntervalSeconds,
        view: form.todoSyncView,
        mqttBrokerUrl: form.todoSyncMqttBrokerUrl.trim(),
        mqttTopic: form.todoSyncMqttTopic.trim(),
        ...(form.todoSyncMqttUsername.trim().length > 0 ? { mqttUsername: form.todoSyncMqttUsername.trim() } : {}),
        ...(form.clearTodoSyncMqttPassword ? { clearMqttPassword: true } : form.todoSyncMqttPassword.length > 0 ? { mqttPassword: form.todoSyncMqttPassword } : {}),
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
      await Effect.runPromise(connection.apply(patch))
      if (pendingLocalManagement?.kind === 'replace') {
        await Effect.runPromise(service.saveLocalManagementToken(
          connection.device.info.deviceId,
          pendingLocalManagement.token,
        ))
        setLocalManagementCredentialStored(true)
      }
      else if (pendingLocalManagement?.kind === 'clear') {
        await Effect.runPromise(service.clearLocalManagementToken(connection.device.info.deviceId))
        setLocalManagementCredentialStored(false)
      }
      await Effect.runPromise(service.saveTodoTarget(
        connection.device.info.deviceId,
        form.todoLanAddress.trim().length > 0 ? form.todoLanAddress.trim() : null,
      ))
      const todoTarget = await Effect.runPromise(service.loadTodoTarget(connection.device.info.deviceId))
      setTodoPushStatus(todoTarget.status)
      setForm(formFromConfig(connection.device.config))
      setForm(current => ({ ...current, todoLanAddress: todoTarget.target?.address ?? '' }))
      setPendingLocalManagement(null)
      setPhase('success')
    }
    catch (error) {
      handleError(error, setErrorCode, setPhase)
    }
  }

  const disconnect = async (): Promise<void> => {
    operation.current += 1
    const activeConnection = connectionRef.current
    connectionRef.current = null
    setConnection(null)
    setLocalManagementCredentialStored(false)
    setTodoPushStatus(null)
    setPendingLocalManagement(null)
    if (activeConnection)
      await Effect.runPromise(activeConnection.close())
    setPhase('idle')
  }

  const forget = async (): Promise<void> => {
    operation.current += 1
    const activeConnection = connectionRef.current
    connectionRef.current = null
    setConnection(null)
    try {
      if (activeConnection) {
        await Effect.runPromise(activeConnection.forget())
        await Effect.runPromise(service.clearLocalManagementToken(activeConnection.device.info.deviceId))
      }
      setLocalManagementCredentialStored(false)
      setTodoPushStatus(null)
      setPendingLocalManagement(null)
      setPhase('idle')
    }
    catch (error) {
      handleError(error, setErrorCode, setPhase)
    }
  }

  const replaceLocalManagementToken = async (): Promise<void> => {
    try {
      const token = await Effect.runPromise(service.generateLocalManagementToken())
      setPendingLocalManagement({ kind: 'replace', token })
      setErrorCode(null)
      setPhase('ready')
    }
    catch (error) {
      handleError(error, setErrorCode, setPhase)
    }
  }

  const statusKey = statusTranslationKey(phase, errorCode)
  const scanDisabled = phase !== 'error' && phase !== 'idle' && phase !== 'timeout'
  const canCancel = phase === 'connecting' || phase === 'pairing' || phase === 'scanning' || phase === 'selecting'

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
                ? t('deviceFirmwareSummary', { version: connection.device.info.firmwareVersion })
                : t('deviceSetupSummary')}
            </p>
          </div>
          {connection
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
                    <button
                      key={device.deviceId}
                      {...stylex.props(styles.deviceButton)}
                      type="button"
                      onClick={() => void selectDevice(device)}
                    >
                      <span {...stylex.props(styles.deviceName)}>{device.deviceName || t('deviceUnnamed')}</span>
                      <span {...stylex.props(styles.deviceAction)}>
                        {t('deviceSelect')}
                        {' '}
                        <ChevronRight aria-hidden="true" size={13} />
                      </span>
                    </button>
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
                <DeviceTextRow description={t('deviceAlmanacDescription')} id="device-almanac-note" label={t('deviceAlmanacNote')} value={form.almanacNote} onChange={almanacNote => setForm(current => ({ ...current, almanacNote }))} />
                <DeviceTextRow description={t('deviceAlmanacDescription')} id="device-almanac-source" label={t('deviceAlmanacSource')} value={form.almanacSource} onChange={almanacSource => setForm(current => ({ ...current, almanacSource }))} />
                <div {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.rowCopy)}>
                    <span {...stylex.props(styles.label)}>{t('deviceTodoSync')}</span>
                    <p {...stylex.props(styles.description)}>{t('deviceTodoSyncDescription')}</p>
                  </div>
                  <Switch id="device-todo-sync-enabled" checked={form.todoSyncEnabled} variant="compact" onCheckedChange={todoSyncEnabled => setForm(current => ({ ...current, todoSyncEnabled }))} />
                </div>
                <DeviceTextRow
                  description={t('deviceTodoSyncLanAddressDescription')}
                  id="device-todo-sync-lan-address"
                  label={t('deviceTodoSyncLanAddress')}
                  value={form.todoLanAddress}
                  onChange={todoLanAddress => setForm(current => ({ ...current, todoLanAddress }))}
                />
                <div {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.rowCopy)}>
                    <span {...stylex.props(styles.label)}>{t('deviceTodoSyncLanStatus')}</span>
                    <p {...stylex.props(styles.description)}>{todoPushStatusText(t, todoPushStatus)}</p>
                  </div>
                </div>
                <DeviceTextRow description={t('deviceTodoSyncUrlDescription')} id="device-todo-sync-url" label={t('deviceTodoSyncUrl')} value={form.todoSyncUrl} onChange={todoSyncUrl => setForm(current => ({ ...current, todoSyncUrl }))} />
                <DeviceTextRow description={t('deviceTodoSyncTokenDescription')} id="device-todo-sync-token" label={t('deviceTodoSyncToken')} type="password" value={form.todoSyncToken} onChange={todoSyncToken => setForm(current => ({ ...current, todoSyncToken }))} />
                {connection.device.config.todoSyncTokenIsSet
                  ? (
                      <div {...stylex.props(styles.row)}>
                        <div {...stylex.props(styles.rowCopy)}>
                          <span {...stylex.props(styles.label)}>{t('deviceTodoSyncClearToken')}</span>
                          <p {...stylex.props(styles.description)}>{t('deviceTodoSyncClearTokenDescription')}</p>
                        </div>
                        <Switch
                          aria-label={t('deviceTodoSyncClearToken')}
                          checked={form.clearTodoSyncToken}
                          disabled={phase === 'applying'}
                          variant="compact"
                          onCheckedChange={clearTodoSyncToken => setForm(current => ({ ...current, clearTodoSyncToken, ...(clearTodoSyncToken ? { todoSyncToken: '' } : {}) }))}
                        />
                      </div>
                    )
                  : null}
                <DeviceTextRow description={t('deviceTodoSyncIntervalDescription')} id="device-todo-sync-interval" label={t('deviceTodoSyncInterval')} min={60} max={86_400} type="number" value={form.todoSyncPollIntervalSeconds} onChange={todoSyncPollIntervalSeconds => setForm(current => ({ ...current, todoSyncPollIntervalSeconds }))} />
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
                <DeviceTextRow description={t('deviceTodoSyncMqttBrokerDescription')} id="device-todo-sync-mqtt-broker" label={t('deviceTodoSyncMqttBroker')} value={form.todoSyncMqttBrokerUrl} onChange={todoSyncMqttBrokerUrl => setForm(current => ({ ...current, todoSyncMqttBrokerUrl }))} />
                <DeviceTextRow description={t('deviceTodoSyncMqttTopicDescription')} id="device-todo-sync-mqtt-topic" label={t('deviceTodoSyncMqttTopic')} value={form.todoSyncMqttTopic} onChange={todoSyncMqttTopic => setForm(current => ({ ...current, todoSyncMqttTopic }))} />
                <DeviceTextRow description={t('deviceTodoSyncMqttUsernameDescription')} id="device-todo-sync-mqtt-username" label={t('deviceTodoSyncMqttUsername')} value={form.todoSyncMqttUsername} onChange={todoSyncMqttUsername => setForm(current => ({ ...current, todoSyncMqttUsername }))} />
                <DeviceTextRow description={t('deviceTodoSyncMqttPasswordDescription')} id="device-todo-sync-mqtt-password" label={t('deviceTodoSyncMqttPassword')} type="password" value={form.todoSyncMqttPassword} onChange={todoSyncMqttPassword => setForm(current => ({ ...current, todoSyncMqttPassword }))} />
                {connection.device.config.todoSyncMqttPasswordIsSet
                  ? (
                      <div {...stylex.props(styles.row)}>
                        <div {...stylex.props(styles.rowCopy)}>
                          <span {...stylex.props(styles.label)}>{t('deviceTodoSyncMqttClearPassword')}</span>
                          <p {...stylex.props(styles.description)}>{t('deviceTodoSyncMqttClearPasswordDescription')}</p>
                        </div>
                        <Switch aria-label={t('deviceTodoSyncMqttClearPassword')} checked={form.clearTodoSyncMqttPassword} disabled={phase === 'applying'} variant="compact" onCheckedChange={clearTodoSyncMqttPassword => setForm(current => ({ ...current, clearTodoSyncMqttPassword, ...(clearTodoSyncMqttPassword ? { todoSyncMqttPassword: '' } : {}) }))} />
                      </div>
                    )
                  : null}
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
                <div {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.rowCopy)}>
                    <span {...stylex.props(styles.label)}>{t('deviceLocalManagement')}</span>
                    <p {...stylex.props(styles.description)}>
                      {t(localManagementDescriptionKey(
                        connection.device.config.localManagementTokenIsSet,
                        localManagementCredentialStored,
                        pendingLocalManagement,
                      ))}
                    </p>
                  </div>
                  <div {...stylex.props(styles.rowActions)}>
                    {pendingLocalManagement
                      ? (
                          <Button
                            disabled={phase === 'applying'}
                            type="button"
                            variant="plain"
                            xstyle={styles.compactButton}
                            onClick={() => setPendingLocalManagement(null)}
                          >
                            {t('deviceLocalManagementUndo')}
                          </Button>
                        )
                      : null}
                    <Button
                      disabled={phase === 'applying'}
                      type="button"
                      variant="secondary"
                      xstyle={styles.compactButton}
                      onClick={() => void replaceLocalManagementToken()}
                    >
                      {t(connection.device.config.localManagementTokenIsSet
                        ? 'deviceLocalManagementRotate'
                        : 'deviceLocalManagementGenerate')}
                    </Button>
                    <Button
                      disabled={phase === 'applying'
                        || (!connection.device.config.localManagementTokenIsSet
                          && pendingLocalManagement?.kind !== 'replace')}
                      type="button"
                      variant="plain"
                      xstyle={styles.compactButton}
                      onClick={() => setPendingLocalManagement({ kind: 'clear' })}
                    >
                      {t('deviceLocalManagementClear')}
                    </Button>
                  </div>
                </div>
                <DeviceGallery
                  client={service}
                  deviceId={connection.device.info.deviceId}
                  enabled={localManagementCredentialStored && pendingLocalManagement?.kind !== 'clear'}
                />
                <DeviceTextRow
                  description={t('deviceTimezoneDescription')}
                  id="device-timezone"
                  label={t('deviceTimezone')}
                  value={form.timezone}
                  onChange={timezone => setForm(current => ({ ...current, timezone }))}
                />
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
                  <Button disabled={phase === 'applying'} type="submit" variant="primary" xstyle={styles.compactButton}>
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
  return {
    clearWifiPassword: false,
    deviceName: config.deviceName,
    idleSleepSeconds: String(config.idleSleepSeconds),
    timezone: config.timezone,
    wifiPassword: '',
    wifiSsid: config.wifiSsid ?? '',
    weatherEnabled: config.weather?.enabled ?? false,
    weatherLocation: config.weather?.locationName ?? '',
    weatherLatitude: String((config.weather?.latitudeE6 ?? 0) / 1_000_000),
    weatherLongitude: String((config.weather?.longitudeE6 ?? 0) / 1_000_000),
    almanacNote: config.almanac?.note ?? '',
    almanacSource: config.almanac?.source ?? '',
    todoSyncEnabled: config.todoSyncEnabled,
    todoLanAddress: '',
    todoSyncUrl: config.todoSyncUrl,
    todoSyncToken: '',
    clearTodoSyncToken: false,
    todoSyncPollIntervalSeconds: String(config.todoSyncPollIntervalSeconds),
    todoSyncView: config.todoSyncView,
    todoSyncMqttBrokerUrl: config.todoSyncMqttBrokerUrl ?? '',
    todoSyncMqttTopic: config.todoSyncMqttTopic ?? '',
    todoSyncMqttUsername: config.todoSyncMqttUsername ?? '',
    todoSyncMqttPassword: '',
    clearTodoSyncMqttPassword: false,
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

function localManagementDescriptionKey(
  deviceTokenIsSet: boolean,
  credentialStored: boolean,
  pending: PendingLocalManagementChange | null,
): string {
  if (pending?.kind === 'replace')
    return 'deviceLocalManagementPendingReplace'
  if (pending?.kind === 'clear')
    return 'deviceLocalManagementPendingClear'
  if (!deviceTokenIsSet)
    return 'deviceLocalManagementNotConfigured'
  return credentialStored
    ? 'deviceLocalManagementStored'
    : 'deviceLocalManagementMissing'
}

function todoPushStatusText(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: DesktopDeviceTodoPushStatus | null,
): string {
  if (status?.phase === 'pending')
    return t('deviceTodoSyncLanStatusPending')
  if (status?.phase === 'success')
    return t('deviceTodoSyncLanStatusSuccess')
  if (status?.phase === 'error')
    return t('deviceTodoSyncLanStatusError', { error: status.lastError ?? 'unknown-error' })
  return t('deviceTodoSyncLanStatusIdle')
}

function isPrivateDeviceAddress(address: string): boolean {
  const match = /^(?<host>(?:\d{1,3}\.){3}\d{1,3})(?::(?<port>\d{1,5}))?$/u.exec(address)
  if (!match?.groups)
    return false
  const host = match.groups.host
  if (host === undefined)
    return false
  const octets = host.split('.').map(Number)
  const first = octets[0] ?? -1
  const second = octets[1] ?? -1
  const port = match.groups.port === undefined ? 80 : Number(match.groups.port)
  return octets.length === 4
    && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254))
    && port >= 1
    && port <= 65_535
}
