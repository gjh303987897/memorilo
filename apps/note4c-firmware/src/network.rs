use std::time::Duration;

#[cfg(target_os = "espidf")]
use serde::Deserialize;
use serde::Serialize;

use crate::framebuffer::FRAME_BYTES;
use crate::gallery::{GALLERY_CAPACITY_BYTES, GalleryAssetId, GalleryCatalog};
use crate::persistence::DeviceConfig;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
pub const MAX_RETRY_DELAY: Duration = Duration::from_secs(5 * 60);
pub const MAX_MANAGEMENT_BODY_BYTES: usize = 1024;

#[derive(Clone, Eq, PartialEq)]
pub struct NetworkConfiguration {
    ssid: String,
    password: String,
    management_token: Option<String>,
}

impl std::fmt::Debug for NetworkConfiguration {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NetworkConfiguration")
            .field("ssid", &self.ssid)
            .field("password", &"<redacted>")
            .field(
                "management_token",
                &self.management_token.as_ref().map(|_| "<redacted>"),
            )
            .finish()
    }
}

impl NetworkConfiguration {
    pub fn from_device_config(config: &DeviceConfig) -> Option<Self> {
        Some(Self {
            ssid: config.wifi.ssid.clone()?,
            password: config.wifi.password().unwrap_or_default().to_owned(),
            management_token: config.local_management.token().map(str::to_owned),
        })
    }

    pub fn has_local_management(&self) -> bool {
        self.management_token.is_some()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NetworkPhase {
    Disabled,
    Idle,
    Connecting,
    Online,
    Backoff,
    AuthenticationFailed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    pub phase: NetworkPhase,
    pub ipv4: Option<String>,
    pub time_synchronized: bool,
    pub consecutive_failures: u8,
    pub retry_at_ms: Option<u64>,
}

impl Default for NetworkSnapshot {
    fn default() -> Self {
        Self {
            phase: NetworkPhase::Disabled,
            ipv4: None,
            time_synchronized: false,
            consecutive_failures: 0,
            retry_at_ms: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkFailure {
    Authentication,
    Dhcp,
    Transport,
    TimeSynchronization,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkAction {
    Connect { deadline: Duration },
    Disconnect,
    StartLocalManagement,
    StopLocalManagement,
}

pub struct NetworkPolicy {
    configured: bool,
    snapshot: NetworkSnapshot,
    retry_at: Option<Duration>,
}

impl NetworkPolicy {
    pub fn new(configured: bool) -> Self {
        Self {
            configured,
            snapshot: NetworkSnapshot {
                phase: if configured {
                    NetworkPhase::Idle
                } else {
                    NetworkPhase::Disabled
                },
                ..NetworkSnapshot::default()
            },
            retry_at: None,
        }
    }

    pub fn snapshot(&self) -> &NetworkSnapshot {
        &self.snapshot
    }

    pub fn start(&mut self, now: Duration) -> Vec<NetworkAction> {
        if !self.configured || self.snapshot.phase == NetworkPhase::Connecting {
            return Vec::new();
        }
        self.snapshot.phase = NetworkPhase::Connecting;
        self.snapshot.retry_at_ms = None;
        vec![NetworkAction::Connect {
            deadline: now + CONNECT_TIMEOUT,
        }]
    }

    pub fn reconfigure(&mut self, configured: bool, now: Duration) -> Vec<NetworkAction> {
        let was_active = matches!(
            self.snapshot.phase,
            NetworkPhase::Connecting | NetworkPhase::Online | NetworkPhase::Backoff
        );
        self.configured = configured;
        self.retry_at = None;
        self.snapshot = NetworkSnapshot {
            phase: if configured {
                NetworkPhase::Idle
            } else {
                NetworkPhase::Disabled
            },
            ..NetworkSnapshot::default()
        };

        let mut actions = Vec::new();
        if was_active {
            actions.push(NetworkAction::StopLocalManagement);
            actions.push(NetworkAction::Disconnect);
        }
        if configured {
            actions.extend(self.start(now));
        }
        actions
    }

    pub fn connected(&mut self, ipv4: impl Into<String>) -> Vec<NetworkAction> {
        self.retry_at = None;
        self.snapshot.phase = NetworkPhase::Online;
        self.snapshot.ipv4 = Some(ipv4.into());
        self.snapshot.consecutive_failures = 0;
        self.snapshot.retry_at_ms = None;
        vec![NetworkAction::StartLocalManagement]
    }

    pub fn time_synchronized(&mut self) {
        if self.snapshot.phase == NetworkPhase::Online {
            self.snapshot.time_synchronized = true;
        }
    }

    pub fn failed(&mut self, failure: NetworkFailure, now: Duration) -> Vec<NetworkAction> {
        self.snapshot.ipv4 = None;
        self.snapshot.time_synchronized = false;
        self.snapshot.consecutive_failures = self.snapshot.consecutive_failures.saturating_add(1);

        if failure == NetworkFailure::Authentication {
            self.retry_at = None;
            self.snapshot.phase = NetworkPhase::AuthenticationFailed;
            self.snapshot.retry_at_ms = None;
            return vec![
                NetworkAction::StopLocalManagement,
                NetworkAction::Disconnect,
            ];
        }

        let retry_delay = retry_delay(self.snapshot.consecutive_failures);
        let retry_at = now + retry_delay;
        self.retry_at = Some(retry_at);
        self.snapshot.phase = NetworkPhase::Backoff;
        self.snapshot.retry_at_ms = Some(duration_millis(retry_at));
        vec![
            NetworkAction::StopLocalManagement,
            NetworkAction::Disconnect,
        ]
    }

    pub fn poll(&mut self, now: Duration) -> Vec<NetworkAction> {
        if self.retry_at.is_none_or(|retry_at| now < retry_at) {
            return Vec::new();
        }
        self.retry_at = None;
        self.start(now)
    }
}

fn retry_delay(failures: u8) -> Duration {
    let exponent = u32::from(failures.saturating_sub(1).min(8));
    Duration::from_secs(5_u64.saturating_mul(1_u64 << exponent)).min(MAX_RETRY_DELAY)
}

fn duration_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManagementMethod {
    Get,
    Post,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManagementRequest {
    Status,
    GalleryList,
    GalleryUpload,
    GalleryDelete,
    GalleryReorder,
    GallerySlideshow,
    Refresh,
    NextPage,
    Sleep,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManagementRequestError {
    AuthenticationRequired,
    BodyTooLarge,
    InvalidBody,
    NotFound,
    MethodNotAllowed,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GalleryMutation {
    Upload {
        name: String,
        created_at_unix_seconds: u64,
        bytes: Vec<u8>,
    },
    Delete {
        id: GalleryAssetId,
    },
    Reorder {
        order: Vec<GalleryAssetId>,
    },
    SetSlideshow {
        interval_seconds: Option<u32>,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryManagementSnapshot {
    pub catalog: GalleryCatalog,
    pub mutation_revision: u64,
    pub last_error: Option<String>,
}

#[cfg(target_os = "espidf")]
#[derive(Deserialize)]
struct GalleryDeleteBody {
    id: GalleryAssetId,
}

#[cfg(target_os = "espidf")]
#[derive(Deserialize)]
struct GalleryReorderBody {
    order: Vec<GalleryAssetId>,
}

#[cfg(target_os = "espidf")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GallerySlideshowBody {
    interval_seconds: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryEnvelope<'a> {
    catalog: &'a GalleryCatalog,
    mutation_revision: u64,
    last_error: &'a Option<String>,
    capacity_bytes: usize,
    image_bytes: usize,
    max_assets: usize,
    full_refresh_seconds: u8,
}

pub fn encode_gallery_status(
    snapshot: &GalleryManagementSnapshot,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&GalleryEnvelope {
        catalog: &snapshot.catalog,
        mutation_revision: snapshot.mutation_revision,
        last_error: &snapshot.last_error,
        capacity_bytes: GALLERY_CAPACITY_BYTES,
        image_bytes: FRAME_BYTES,
        max_assets: crate::gallery::MAX_GALLERY_ASSETS,
        full_refresh_seconds: 20,
    })
}

pub fn decode_gallery_name_header(value: &str) -> Option<String> {
    if value.is_empty() || value.len() > 768 {
        return None;
    }
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_digit(*bytes.get(index + 1)?)?;
            let low = hex_digit(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let decoded = String::from_utf8(decoded).ok()?;
    if decoded.is_empty() || decoded.chars().count() > 64 || decoded.chars().any(char::is_control) {
        return None;
    }
    Some(decoded)
}

const fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ManagementAudit {
    pub request: Option<ManagementRequest>,
    pub accepted: bool,
    pub error: Option<ManagementRequestError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagementStatusEnvelope<'a> {
    firmware_version: &'static str,
    uptime_ms: u64,
    network: &'a NetworkSnapshot,
}

pub fn encode_management_status(
    snapshot: &NetworkSnapshot,
    uptime: Duration,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&ManagementStatusEnvelope {
        firmware_version: env!("CARGO_PKG_VERSION"),
        uptime_ms: duration_millis(uptime),
        network: snapshot,
    })
}

pub fn management_queue_audit(audit: ManagementAudit, queued: bool) -> ManagementAudit {
    ManagementAudit {
        accepted: queued,
        error: (!queued).then_some(ManagementRequestError::Unavailable),
        ..audit
    }
}

pub fn parse_management_request(
    method: ManagementMethod,
    path: &str,
    content_length: usize,
    authorization: Option<&str>,
    expected_token: &str,
) -> Result<(ManagementRequest, ManagementAudit), ManagementAudit> {
    if !authorize_bearer(authorization, expected_token) {
        return Err(ManagementAudit {
            request: None,
            accepted: false,
            error: Some(ManagementRequestError::AuthenticationRequired),
        });
    }
    let expected_method = match path {
        "/v1/status" | "/v1/gallery" => ManagementMethod::Get,
        _ => ManagementMethod::Post,
    };
    let request = match path {
        "/v1/status" => Some(ManagementRequest::Status),
        "/v1/gallery" => Some(ManagementRequest::GalleryList),
        "/v1/gallery/assets" => Some(ManagementRequest::GalleryUpload),
        "/v1/gallery/delete" => Some(ManagementRequest::GalleryDelete),
        "/v1/gallery/reorder" => Some(ManagementRequest::GalleryReorder),
        "/v1/gallery/slideshow" => Some(ManagementRequest::GallerySlideshow),
        "/v1/commands/refresh" => Some(ManagementRequest::Refresh),
        "/v1/commands/next-page" => Some(ManagementRequest::NextPage),
        "/v1/commands/sleep" => Some(ManagementRequest::Sleep),
        _ => None,
    };
    let Some(request) = request else {
        return Err(ManagementAudit {
            request: None,
            accepted: false,
            error: Some(ManagementRequestError::NotFound),
        });
    };
    if request == ManagementRequest::GalleryUpload && content_length != FRAME_BYTES {
        return Err(ManagementAudit {
            request: Some(request),
            accepted: false,
            error: Some(ManagementRequestError::InvalidBody),
        });
    }
    if request != ManagementRequest::GalleryUpload && content_length > MAX_MANAGEMENT_BODY_BYTES {
        return Err(ManagementAudit {
            request: Some(request),
            accepted: false,
            error: Some(ManagementRequestError::BodyTooLarge),
        });
    }
    if method != expected_method {
        return Err(ManagementAudit {
            request: Some(request),
            accepted: false,
            error: Some(ManagementRequestError::MethodNotAllowed),
        });
    }

    Ok((
        request,
        ManagementAudit {
            request: Some(request),
            accepted: true,
            error: None,
        },
    ))
}

pub fn authorize_bearer(authorization: Option<&str>, expected_token: &str) -> bool {
    let Some(provided) = authorization.and_then(|value| value.strip_prefix("Bearer ")) else {
        return false;
    };
    if expected_token.len() < 32 || provided.len() != expected_token.len() {
        return false;
    }
    provided
        .as_bytes()
        .iter()
        .zip(expected_token.as_bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(target_os = "espidf")]
pub mod runtime {
    use std::sync::mpsc::{Receiver, SyncSender, TryRecvError, sync_channel};
    use std::sync::{Arc, RwLock};
    use std::thread;
    use std::time::Duration;

    use anyhow::{Context, Result};
    use esp_idf_svc::eventloop::EspSystemEventLoop;
    use esp_idf_svc::http::Method;
    use esp_idf_svc::http::server::{
        Configuration as HttpConfiguration, EspHttpConnection, EspHttpServer, Request,
    };
    use esp_idf_svc::io::{Read, Write};
    use esp_idf_svc::sntp::{EspSntp, SyncStatus};
    use esp_idf_svc::wifi::{AuthMethod, ClientConfiguration, Configuration, EspWifi, WifiEvent};

    use super::{
        FRAME_BYTES, GalleryDeleteBody, GalleryManagementSnapshot, GalleryMutation,
        GalleryReorderBody, GallerySlideshowBody, ManagementAudit, ManagementMethod,
        ManagementRequest, ManagementRequestError, NetworkAction, NetworkConfiguration,
        NetworkFailure, NetworkPhase, NetworkPolicy, NetworkSnapshot, decode_gallery_name_header,
        encode_gallery_status, encode_management_status, management_queue_audit,
        parse_management_request,
    };

    const POLL_INTERVAL: Duration = Duration::from_millis(100);

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum NetworkRuntimeEvent {
        Snapshot(NetworkSnapshot),
        Management(ManagementRequest),
        Gallery(GalleryMutation),
        Audit(ManagementAudit),
        Failed(&'static str),
        Stopped,
    }

    enum NetworkRuntimeCommand {
        Reconfigure(Option<NetworkConfiguration>),
        Shutdown,
    }

    pub struct NetworkRuntime {
        command_tx: SyncSender<NetworkRuntimeCommand>,
        event_rx: Receiver<NetworkRuntimeEvent>,
        gallery: Arc<RwLock<GalleryManagementSnapshot>>,
    }

    impl NetworkRuntime {
        pub fn spawn(
            wifi: EspWifi<'static>,
            system_loop: EspSystemEventLoop,
            initial: Option<NetworkConfiguration>,
            initial_gallery: crate::gallery::GalleryCatalog,
        ) -> Result<Self> {
            let (command_tx, command_rx) = sync_channel(4);
            let (event_tx, event_rx) = sync_channel(16);
            let gallery = Arc::new(RwLock::new(GalleryManagementSnapshot {
                catalog: initial_gallery,
                ..GalleryManagementSnapshot::default()
            }));
            let runtime_gallery = Arc::clone(&gallery);
            thread::Builder::new()
                .name("memorilo-network".into())
                .stack_size(12 * 1024)
                .spawn(move || {
                    if let Err(error) = run_network(
                        wifi,
                        system_loop,
                        initial,
                        command_rx,
                        &event_tx,
                        runtime_gallery,
                    ) {
                        log::error!("network service stopped unexpectedly: {error:#}");
                        let _ = event_tx.send(NetworkRuntimeEvent::Failed("network-runtime"));
                    }
                    let _ = event_tx.send(NetworkRuntimeEvent::Stopped);
                })
                .context("network service thread creation failed")?;
            Ok(Self {
                command_tx,
                event_rx,
                gallery,
            })
        }

        pub fn reconfigure(&self, config: Option<NetworkConfiguration>) -> Result<()> {
            self.command_tx
                .send(NetworkRuntimeCommand::Reconfigure(config))
                .context("network service command channel closed")
        }

        pub fn shutdown(&self) -> Result<()> {
            self.command_tx
                .send(NetworkRuntimeCommand::Shutdown)
                .context("network service command channel closed")
        }

        pub fn try_recv(&self) -> Result<Option<NetworkRuntimeEvent>> {
            match self.event_rx.try_recv() {
                Ok(event) => Ok(Some(event)),
                Err(TryRecvError::Empty) => Ok(None),
                Err(TryRecvError::Disconnected) => {
                    anyhow::bail!("network service event channel closed")
                }
            }
        }

        pub fn publish_gallery(
            &self,
            catalog: crate::gallery::GalleryCatalog,
            last_error: Option<String>,
        ) -> Result<()> {
            let mut snapshot = self
                .gallery
                .write()
                .map_err(|_| anyhow::anyhow!("gallery status lock poisoned"))?;
            snapshot.catalog = catalog;
            snapshot.mutation_revision = snapshot.mutation_revision.saturating_add(1);
            snapshot.last_error = last_error;
            Ok(())
        }
    }

    fn run_network(
        mut wifi: EspWifi<'static>,
        system_loop: EspSystemEventLoop,
        mut config: Option<NetworkConfiguration>,
        command_rx: Receiver<NetworkRuntimeCommand>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
        shared_gallery: Arc<RwLock<GalleryManagementSnapshot>>,
    ) -> Result<()> {
        let (disconnect_tx, disconnect_rx) = sync_channel(8);
        let _wifi_subscription = system_loop
            .subscribe::<WifiEvent, _>(move |event| {
                if let WifiEvent::StaDisconnected(disconnected) = event {
                    let _ = disconnect_tx.try_send(disconnected.reason());
                }
            })
            .context("Wi-Fi event subscription failed")?;
        let mut policy = NetworkPolicy::new(config.is_some());
        let mut connect_deadline = None;
        let mut sntp: Option<EspSntp<'static>> = None;
        let mut management_server: Option<EspHttpServer<'static>> = None;
        let shared_snapshot = Arc::new(RwLock::new(policy.snapshot().clone()));

        publish_snapshot(&policy, &shared_snapshot, event_tx)?;
        execute_actions(
            &mut wifi,
            config.as_ref(),
            policy.start(crate::diagnostics::uptime()),
            &mut connect_deadline,
            &mut sntp,
            &mut management_server,
            &shared_snapshot,
            &shared_gallery,
            event_tx,
        )?;
        publish_snapshot(&policy, &shared_snapshot, event_tx)?;

        loop {
            match command_rx.recv_timeout(POLL_INTERVAL) {
                Ok(NetworkRuntimeCommand::Reconfigure(next)) => {
                    config = next;
                    let actions =
                        policy.reconfigure(config.is_some(), crate::diagnostics::uptime());
                    execute_actions(
                        &mut wifi,
                        config.as_ref(),
                        actions,
                        &mut connect_deadline,
                        &mut sntp,
                        &mut management_server,
                        &shared_snapshot,
                        &shared_gallery,
                        event_tx,
                    )?;
                    publish_snapshot(&policy, &shared_snapshot, event_tx)?;
                }
                Ok(NetworkRuntimeCommand::Shutdown) => {
                    disconnect(&mut wifi, &mut sntp, &mut management_server);
                    return Ok(());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    disconnect(&mut wifi, &mut sntp, &mut management_server);
                    return Ok(());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            }

            let now = crate::diagnostics::uptime();
            let mut failure = None;
            while let Ok(reason) = disconnect_rx.try_recv() {
                if matches!(
                    policy.snapshot().phase,
                    NetworkPhase::Connecting | NetworkPhase::Online
                ) {
                    failure = Some(if is_authentication_reason(reason) {
                        NetworkFailure::Authentication
                    } else {
                        NetworkFailure::Transport
                    });
                }
            }
            if failure.is_none()
                && policy.snapshot().phase == NetworkPhase::Connecting
                && wifi.is_up().unwrap_or(false)
            {
                let ipv4 = wifi
                    .sta_netif()
                    .get_ip_info()
                    .map(|info| info.ip.to_string())
                    .unwrap_or_else(|_| "unavailable".into());
                let actions = policy.connected(ipv4);
                execute_actions(
                    &mut wifi,
                    config.as_ref(),
                    actions,
                    &mut connect_deadline,
                    &mut sntp,
                    &mut management_server,
                    &shared_snapshot,
                    &shared_gallery,
                    event_tx,
                )?;
                publish_snapshot(&policy, &shared_snapshot, event_tx)?;
            } else if failure.is_none() && connect_deadline.is_some_and(|deadline| now >= deadline)
            {
                failure = Some(NetworkFailure::Transport);
            }
            if let Some(failure) = failure {
                let actions = policy.failed(failure, now);
                execute_actions(
                    &mut wifi,
                    config.as_ref(),
                    actions,
                    &mut connect_deadline,
                    &mut sntp,
                    &mut management_server,
                    &shared_snapshot,
                    &shared_gallery,
                    event_tx,
                )?;
                publish_snapshot(&policy, &shared_snapshot, event_tx)?;
            }

            if policy.snapshot().phase == NetworkPhase::Online
                && !policy.snapshot().time_synchronized
                && sntp
                    .as_ref()
                    .is_some_and(|service| service.get_sync_status() == SyncStatus::Completed)
            {
                policy.time_synchronized();
                publish_snapshot(&policy, &shared_snapshot, event_tx)?;
            }

            let actions = policy.poll(now);
            if !actions.is_empty() {
                execute_actions(
                    &mut wifi,
                    config.as_ref(),
                    actions,
                    &mut connect_deadline,
                    &mut sntp,
                    &mut management_server,
                    &shared_snapshot,
                    &shared_gallery,
                    event_tx,
                )?;
                publish_snapshot(&policy, &shared_snapshot, event_tx)?;
            }
        }
    }

    fn publish_snapshot(
        policy: &NetworkPolicy,
        shared_snapshot: &Arc<RwLock<NetworkSnapshot>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
    ) -> Result<()> {
        let snapshot = policy.snapshot().clone();
        *shared_snapshot
            .write()
            .map_err(|_| anyhow::anyhow!("network status lock poisoned"))? = snapshot.clone();
        event_tx.send(NetworkRuntimeEvent::Snapshot(snapshot))?;
        Ok(())
    }

    fn execute_actions(
        wifi: &mut EspWifi<'static>,
        config: Option<&NetworkConfiguration>,
        actions: Vec<NetworkAction>,
        connect_deadline: &mut Option<Duration>,
        sntp: &mut Option<EspSntp<'static>>,
        management_server: &mut Option<EspHttpServer<'static>>,
        shared_snapshot: &Arc<RwLock<NetworkSnapshot>>,
        shared_gallery: &Arc<RwLock<GalleryManagementSnapshot>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
    ) -> Result<()> {
        for action in actions {
            match action {
                NetworkAction::Connect { deadline } => {
                    let config =
                        config.context("network connect requested without configuration")?;
                    let client = ClientConfiguration {
                        ssid: config
                            .ssid
                            .as_str()
                            .try_into()
                            .context("invalid Wi-Fi SSID")?,
                        password: config
                            .password
                            .as_str()
                            .try_into()
                            .context("invalid Wi-Fi password")?,
                        auth_method: if config.password.is_empty() {
                            AuthMethod::None
                        } else {
                            AuthMethod::WPA2Personal
                        },
                        ..ClientConfiguration::default()
                    };
                    let was_started = wifi.is_started().unwrap_or(false);
                    if was_started {
                        let _ = wifi.disconnect();
                    }
                    wifi.set_configuration(&Configuration::Client(client))?;
                    if !was_started {
                        wifi.start()?;
                    }
                    wifi.connect()?;
                    *connect_deadline = Some(deadline);
                    log::info!("Wi-Fi connection attempt started ssid={}", config.ssid);
                }
                NetworkAction::Disconnect => {
                    disconnect(wifi, sntp, management_server);
                    *connect_deadline = None;
                }
                NetworkAction::StartLocalManagement => {
                    if sntp.is_none() {
                        *sntp = Some(EspSntp::new_default()?);
                        log::info!("SNTP synchronization started");
                    }
                    if management_server.is_none()
                        && let Some(token) =
                            config.and_then(|config| config.management_token.clone())
                    {
                        *management_server = Some(start_management_server(
                            token,
                            Arc::clone(shared_snapshot),
                            Arc::clone(shared_gallery),
                            event_tx.clone(),
                        )?);
                        log::info!("authenticated local management started");
                    }
                }
                NetworkAction::StopLocalManagement => {
                    *sntp = None;
                    *management_server = None;
                }
            }
        }
        Ok(())
    }

    fn disconnect(
        wifi: &mut EspWifi<'static>,
        sntp: &mut Option<EspSntp<'static>>,
        management_server: &mut Option<EspHttpServer<'static>>,
    ) {
        *sntp = None;
        *management_server = None;
        if wifi.is_connected().unwrap_or(false) {
            let _ = wifi.disconnect();
        }
    }

    fn is_authentication_reason(reason: u16) -> bool {
        matches!(reason, 2 | 15 | 202 | 204)
    }

    fn start_management_server(
        token: String,
        shared_snapshot: Arc<RwLock<NetworkSnapshot>>,
        shared_gallery: Arc<RwLock<GalleryManagementSnapshot>>,
        event_tx: SyncSender<NetworkRuntimeEvent>,
    ) -> Result<EspHttpServer<'static>> {
        let mut server = EspHttpServer::new(&HttpConfiguration {
            stack_size: 8 * 1024,
            ..HttpConfiguration::default()
        })?;
        register_endpoint(
            &mut server,
            "/v1/status",
            Method::Get,
            ManagementMethod::Get,
            ManagementRequest::Status,
            &token,
            Some(&shared_snapshot),
            None,
            &event_tx,
        )?;
        register_endpoint(
            &mut server,
            "/v1/gallery",
            Method::Get,
            ManagementMethod::Get,
            ManagementRequest::GalleryList,
            &token,
            None,
            Some(&shared_gallery),
            &event_tx,
        )?;
        register_endpoint(
            &mut server,
            "/v1/gallery/assets",
            Method::Post,
            ManagementMethod::Post,
            ManagementRequest::GalleryUpload,
            &token,
            None,
            None,
            &event_tx,
        )?;
        for (path, request) in [
            ("/v1/gallery/delete", ManagementRequest::GalleryDelete),
            ("/v1/gallery/reorder", ManagementRequest::GalleryReorder),
            ("/v1/gallery/slideshow", ManagementRequest::GallerySlideshow),
        ] {
            register_endpoint(
                &mut server,
                path,
                Method::Post,
                ManagementMethod::Post,
                request,
                &token,
                None,
                None,
                &event_tx,
            )?;
        }
        for (path, request) in [
            ("/v1/commands/refresh", ManagementRequest::Refresh),
            ("/v1/commands/next-page", ManagementRequest::NextPage),
            ("/v1/commands/sleep", ManagementRequest::Sleep),
        ] {
            register_endpoint(
                &mut server,
                path,
                Method::Post,
                ManagementMethod::Post,
                request,
                &token,
                None,
                None,
                &event_tx,
            )?;
        }
        Ok(server)
    }

    #[allow(clippy::too_many_arguments)]
    fn register_endpoint(
        server: &mut EspHttpServer<'static>,
        path: &'static str,
        http_method: Method,
        management_method: ManagementMethod,
        expected_request: ManagementRequest,
        token: &str,
        shared_snapshot: Option<&Arc<RwLock<NetworkSnapshot>>>,
        shared_gallery: Option<&Arc<RwLock<GalleryManagementSnapshot>>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
    ) -> Result<()> {
        let token = token.to_owned();
        let shared_snapshot = shared_snapshot.cloned();
        let shared_gallery = shared_gallery.cloned();
        let event_tx = event_tx.clone();
        server.fn_handler::<anyhow::Error, _>(
            http_method_path(path),
            http_method,
            move |request| {
                handle_http_request(
                    request,
                    path,
                    management_method,
                    expected_request,
                    &token,
                    shared_snapshot.as_ref(),
                    shared_gallery.as_ref(),
                    &event_tx,
                )
            },
        )?;
        Ok(())
    }

    const fn http_method_path(path: &'static str) -> &'static str {
        path
    }

    fn handle_http_request(
        mut request: Request<&mut EspHttpConnection<'_>>,
        path: &'static str,
        method: ManagementMethod,
        expected_request: ManagementRequest,
        token: &str,
        shared_snapshot: Option<&Arc<RwLock<NetworkSnapshot>>>,
        shared_gallery: Option<&Arc<RwLock<GalleryManagementSnapshot>>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
    ) -> Result<()> {
        let content_length = request
            .header("Content-Length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let authorization = request.header("Authorization");
        match parse_management_request(method, path, content_length, authorization, token) {
            Ok((parsed, audit)) if parsed == expected_request => {
                if parsed == ManagementRequest::Status {
                    let Some(shared_snapshot) = shared_snapshot else {
                        anyhow::bail!("status endpoint registered without status state");
                    };
                    let snapshot = shared_snapshot
                        .read()
                        .map_err(|_| anyhow::anyhow!("network status lock poisoned"))?;
                    let body = encode_management_status(&snapshot, crate::diagnostics::uptime())?;
                    let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(audit));
                    request.into_status_response(200)?.write_all(&body)?;
                    return Ok(());
                }
                if parsed == ManagementRequest::GalleryList {
                    let Some(shared_gallery) = shared_gallery else {
                        anyhow::bail!("gallery endpoint registered without gallery state");
                    };
                    let snapshot = shared_gallery
                        .read()
                        .map_err(|_| anyhow::anyhow!("gallery status lock poisoned"))?;
                    let body = encode_gallery_status(&snapshot)?;
                    let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(audit));
                    request.into_status_response(200)?.write_all(&body)?;
                    return Ok(());
                }
                let event = match parsed {
                    ManagementRequest::GalleryUpload => {
                        let Some(name) = request
                            .header("X-Memorilo-Asset-Name")
                            .and_then(decode_gallery_name_header)
                        else {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        };
                        let created_at_unix_seconds = request
                            .header("X-Memorilo-Created-At")
                            .and_then(|value| value.parse::<u64>().ok())
                            .unwrap_or(0);
                        let mut bytes = vec![0_u8; FRAME_BYTES];
                        if request.read_exact(&mut bytes).is_err() {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        }
                        NetworkRuntimeEvent::Gallery(GalleryMutation::Upload {
                            name,
                            created_at_unix_seconds,
                            bytes,
                        })
                    }
                    ManagementRequest::GalleryDelete
                    | ManagementRequest::GalleryReorder
                    | ManagementRequest::GallerySlideshow => {
                        let mut body = vec![0_u8; content_length];
                        if request.read_exact(&mut body).is_err() {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        }
                        let mutation = match parsed {
                            ManagementRequest::GalleryDelete => {
                                serde_json::from_slice::<GalleryDeleteBody>(&body)
                                    .map(|body| GalleryMutation::Delete { id: body.id })
                            }
                            ManagementRequest::GalleryReorder => {
                                serde_json::from_slice::<GalleryReorderBody>(&body)
                                    .map(|body| GalleryMutation::Reorder { order: body.order })
                            }
                            ManagementRequest::GallerySlideshow => {
                                serde_json::from_slice::<GallerySlideshowBody>(&body).map(|body| {
                                    GalleryMutation::SetSlideshow {
                                        interval_seconds: body.interval_seconds,
                                    }
                                })
                            }
                            _ => unreachable!(),
                        };
                        let Ok(mutation) = mutation else {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        };
                        NetworkRuntimeEvent::Gallery(mutation)
                    }
                    _ => NetworkRuntimeEvent::Management(parsed),
                };
                let queued = event_tx.try_send(event).is_ok();
                let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(management_queue_audit(
                    audit, queued,
                )));
                let mut response = request.into_status_response(if queued { 202 } else { 503 })?;
                response.write_all(if queued {
                    br#"{"accepted":true}"#
                } else {
                    br#"{"accepted":false}"#
                })?;
            }
            Ok((_, audit)) => {
                let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(ManagementAudit {
                    accepted: false,
                    error: Some(ManagementRequestError::NotFound),
                    ..audit
                }));
                request
                    .into_status_response(404)?
                    .write_all(br#"{"error":"not-found"}"#)?;
            }
            Err(audit) => {
                let status = match audit.error {
                    Some(ManagementRequestError::AuthenticationRequired) => 401,
                    Some(ManagementRequestError::BodyTooLarge) => 413,
                    Some(ManagementRequestError::InvalidBody) => 400,
                    Some(ManagementRequestError::MethodNotAllowed) => 405,
                    Some(ManagementRequestError::Unavailable) => 503,
                    _ => 404,
                };
                let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(audit));
                request
                    .into_status_response(status)?
                    .write_all(br#"{"accepted":false}"#)?;
            }
        }
        Ok(())
    }

    fn respond_invalid_body(
        request: Request<&mut EspHttpConnection<'_>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
        audit: ManagementAudit,
    ) -> Result<()> {
        let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(ManagementAudit {
            accepted: false,
            error: Some(ManagementRequestError::InvalidBody),
            ..audit
        }));
        request
            .into_status_response(400)?
            .write_all(br#"{"accepted":false,"error":"invalid-body"}"#)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn wrong_credentials_wait_for_ble_replacement_instead_of_retrying_forever() {
        let mut policy = NetworkPolicy::new(true);
        assert_eq!(
            policy.start(Duration::ZERO),
            vec![NetworkAction::Connect {
                deadline: CONNECT_TIMEOUT,
            }]
        );
        policy.failed(NetworkFailure::Authentication, Duration::from_secs(3));
        assert_eq!(policy.snapshot().phase, NetworkPhase::AuthenticationFailed);
        assert!(policy.poll(Duration::from_secs(60 * 60)).is_empty());

        let actions = policy.reconfigure(true, Duration::from_secs(60 * 60));
        assert_eq!(
            actions.last(),
            Some(&NetworkAction::Connect {
                deadline: Duration::from_secs(60 * 60) + CONNECT_TIMEOUT,
            })
        );
    }

    #[test]
    fn transient_failures_back_off_with_a_bounded_connection_lease() {
        let mut policy = NetworkPolicy::new(true);
        policy.start(Duration::ZERO);
        policy.failed(NetworkFailure::Transport, Duration::from_secs(1));
        assert_eq!(policy.snapshot().phase, NetworkPhase::Backoff);
        assert!(policy.poll(Duration::from_secs(5)).is_empty());
        assert_eq!(
            policy.poll(Duration::from_secs(6)),
            vec![NetworkAction::Connect {
                deadline: Duration::from_secs(6) + CONNECT_TIMEOUT,
            }]
        );

        for attempt in 0..20 {
            policy.failed(NetworkFailure::Dhcp, Duration::from_secs(1000 + attempt));
        }
        let retry_at = policy.snapshot().retry_at_ms.unwrap();
        assert!(retry_at <= 1_019_000 + duration_millis(MAX_RETRY_DELAY));
    }

    #[test]
    fn local_management_requires_a_long_bearer_and_bounds_requests() {
        assert_eq!(
            parse_management_request(
                ManagementMethod::Get,
                "/v1/status",
                0,
                Some("Bearer wrong"),
                TOKEN,
            )
            .unwrap_err()
            .error,
            Some(ManagementRequestError::AuthenticationRequired)
        );
        assert_eq!(
            parse_management_request(
                ManagementMethod::Post,
                "/v1/commands/refresh",
                MAX_MANAGEMENT_BODY_BYTES + 1,
                Some(&format!("Bearer {TOKEN}")),
                TOKEN,
            )
            .unwrap_err()
            .error,
            Some(ManagementRequestError::BodyTooLarge)
        );
        assert_eq!(
            parse_management_request(
                ManagementMethod::Post,
                "/v1/gallery/assets",
                FRAME_BYTES - 1,
                Some(&format!("Bearer {TOKEN}")),
                TOKEN,
            )
            .unwrap_err()
            .error,
            Some(ManagementRequestError::InvalidBody)
        );
        assert_eq!(
            parse_management_request(
                ManagementMethod::Post,
                "/v1/gallery/assets",
                FRAME_BYTES,
                Some(&format!("Bearer {TOKEN}")),
                TOKEN,
            )
            .unwrap()
            .0,
            ManagementRequest::GalleryUpload
        );
    }

    #[test]
    fn status_json_is_bounded_and_command_queue_saturation_is_audited() {
        let snapshot = NetworkSnapshot {
            phase: NetworkPhase::Online,
            ipv4: Some("192.0.2.42".into()),
            time_synchronized: true,
            consecutive_failures: 0,
            retry_at_ms: None,
        };
        let json = encode_management_status(&snapshot, Duration::from_secs(12)).unwrap();
        assert!(json.len() < MAX_MANAGEMENT_BODY_BYTES);
        let value: serde_json::Value = serde_json::from_slice(&json).unwrap();
        assert_eq!(value["uptimeMs"], 12_000);
        assert_eq!(value["network"]["phase"], "online");
        assert_eq!(value["network"]["ipv4"], "192.0.2.42");

        let audit = management_queue_audit(
            ManagementAudit {
                request: Some(ManagementRequest::Refresh),
                accepted: true,
                error: None,
            },
            false,
        );
        assert!(!audit.accepted);
        assert_eq!(audit.error, Some(ManagementRequestError::Unavailable));
    }

    #[test]
    fn gallery_status_exposes_storage_and_refresh_cost_without_asset_bytes() {
        let snapshot = GalleryManagementSnapshot {
            catalog: GalleryCatalog::default(),
            mutation_revision: 3,
            last_error: Some("capacity-exceeded".into()),
        };
        let json = encode_gallery_status(&snapshot).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&json).unwrap();
        assert_eq!(value["mutationRevision"], 3);
        assert_eq!(value["imageBytes"], FRAME_BYTES);
        assert_eq!(value["maxAssets"], 100);
        assert_eq!(value["fullRefreshSeconds"], 20);
        assert_eq!(value["lastError"], "capacity-exceeded");
        assert!(json.len() < MAX_MANAGEMENT_BODY_BYTES);
    }

    #[test]
    fn gallery_names_decode_utf8_without_permitting_control_characters() {
        assert_eq!(
            decode_gallery_name_header("%E5%9B%9B%E8%89%B2%20photo"),
            Some("四色 photo".into())
        );
        assert_eq!(decode_gallery_name_header("bad%0Aname"), None);
        assert_eq!(decode_gallery_name_header("bad%XXname"), None);
    }

    #[test]
    fn network_configuration_debug_output_redacts_all_credentials() {
        let mut config = DeviceConfig::default();
        config.wifi.set_ssid(Some("Office".into())).unwrap();
        config.wifi.set_password("password-123").unwrap();
        config.local_management.set_token(TOKEN.to_owned()).unwrap();
        let network = NetworkConfiguration::from_device_config(&config).unwrap();
        let debug = format!("{network:?}");
        assert!(debug.contains("Office"));
        assert!(!debug.contains("password-123"));
        assert!(!debug.contains(TOKEN));
        assert!(network.has_local_management());
    }
}
