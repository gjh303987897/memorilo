use crate::device_status::DeviceStatusSnapshot;
use crate::diagnostics::RuntimeDiagnostics;
use crate::display_coordinator::DisplayEvent;
use crate::gallery::GalleryCatalog;
use crate::glance::{WeatherReading, WeatherSnapshot};
use crate::model::TodoModel;
use crate::network::NetworkSnapshot;
use crate::persistence::{DeviceConfig, PersistentState};
use crate::provisioning::{ProvisioningPhase, ProvisioningSnapshot};
use crate::todo_sync::TodoSyncState;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PageId {
    Todos,
    Gallery,
    Calendar,
    Weather,
    Provisioning,
    Diagnostics,
}

impl PageId {
    fn next(self) -> Self {
        match self {
            Self::Todos => Self::Gallery,
            Self::Gallery => Self::Calendar,
            Self::Calendar => Self::Weather,
            Self::Weather | Self::Provisioning | Self::Diagnostics => Self::Todos,
        }
    }

    fn previous(self) -> Self {
        match self {
            Self::Todos | Self::Provisioning | Self::Diagnostics => Self::Weather,
            Self::Gallery => Self::Todos,
            Self::Calendar => Self::Gallery,
            Self::Weather => Self::Calendar,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleState {
    Created,
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServiceId {
    Display,
    Persistence,
    Status,
    Provisioning,
    Network,
}

impl ServiceId {
    const ALL: [Self; 5] = [
        Self::Display,
        Self::Persistence,
        Self::Status,
        Self::Provisioning,
        Self::Network,
    ];

    const fn index(self) -> usize {
        match self {
            Self::Display => 0,
            Self::Persistence => 1,
            Self::Status => 2,
            Self::Provisioning => 3,
            Self::Network => 4,
        }
    }

    const fn error_label(self) -> &'static str {
        match self {
            Self::Display => "display",
            Self::Persistence => "persistence",
            Self::Status => "status",
            Self::Provisioning => "provisioning",
            Self::Network => "network",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServicePhase {
    Disabled,
    Dormant,
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceSnapshot {
    phases: [ServicePhase; ServiceId::ALL.len()],
}

impl ServiceSnapshot {
    pub fn phase(&self, service: ServiceId) -> ServicePhase {
        self.phases[service.index()]
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApplicationSnapshot {
    pub lifecycle: LifecycleState,
    pub page: PageId,
    pub todo_page: usize,
    pub todos: TodoModel,
    pub todo_sync: TodoSyncState,
    pub render_revision: u64,
    pub services: ServiceSnapshot,
    pub display: DisplaySnapshot,
    pub diagnostics: RuntimeDiagnostics,
    pub network: NetworkSnapshot,
    pub gallery: GallerySnapshot,
    pub glance: GlanceSnapshot,
    pub settings: SettingsSnapshot,
    pub config: DeviceConfig,
    pub status: DeviceStatusSnapshot,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GlanceSnapshot {
    pub calendar_month_offset: i16,
    pub weather: WeatherSnapshot,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GallerySnapshot {
    pub catalog: GalleryCatalog,
    pub selected: usize,
    pub fullscreen: bool,
    pub fullscreen_frame: Option<Vec<u8>>,
    pub last_error: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SettingsSnapshot {
    pub selected: usize,
    pub item_count: usize,
    pub provisioning_requested: bool,
    pub provisioning: ProvisioningSnapshot,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisplayPhase {
    Idle,
    Delayed,
    Busy,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DisplaySnapshot {
    pub phase: DisplayPhase,
    pub requested_revision: Option<u64>,
    pub displayed_revision: Option<u64>,
    pub skipped_revision: Option<u64>,
    pub failed_revision: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ApplicationCommand {
    SelectPrevious,
    SelectNext,
    ActivateSelection,
    Refresh,
    RequestSleep,
    ServiceStarted(ServiceId),
    ServiceStopped(ServiceId),
    ServiceFailed(ServiceId),
    Display(DisplayEvent),
    PreviousPage,
    NextPage,
    EnterDiagnostics,
    EnterProvisioning,
    DiagnosticsUpdated(RuntimeDiagnostics),
    NetworkUpdated(NetworkSnapshot),
    TodosSynced(TodoModel),
    TodoSyncStatus(TodoSyncState),
    GalleryUpdated(GalleryCatalog),
    EnterGalleryFullscreen,
    GalleryFrameLoaded(Option<Vec<u8>>),
    GalleryFailed(String),
    WeatherFetching,
    WeatherFetched(WeatherReading),
    WeatherFailed { at_unix_seconds: i64, error: String },
    WeatherClock(Option<i64>),
    ProvisioningUpdated(ProvisioningSnapshot),
    ConfigApplied(DeviceConfig),
    StatusUpdated(DeviceStatusSnapshot),
    Shutdown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServiceRequest {
    Start(ServiceId),
    Stop(ServiceId),
    Reconfigure(ServiceId),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RenderIntent {
    pub page: PageId,
    pub revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PowerRequest {
    Sleep,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Transition {
    pub render: Option<RenderIntent>,
    pub service_requests: Vec<ServiceRequest>,
    pub power_request: Option<PowerRequest>,
}

pub struct Application {
    snapshot: ApplicationSnapshot,
}

impl Application {
    pub fn new(enabled_services: impl IntoIterator<Item = ServiceId>) -> Self {
        Self::with_state(enabled_services, PersistentState::default())
    }

    pub fn with_state(
        enabled_services: impl IntoIterator<Item = ServiceId>,
        state: PersistentState,
    ) -> Self {
        let mut phases = [ServicePhase::Disabled; ServiceId::ALL.len()];
        for service in enabled_services {
            phases[service.index()] = ServicePhase::Dormant;
        }
        let mut weather = WeatherSnapshot::from_cache(state.weather_cache, None);
        weather.set_enabled(state.config.weather.enabled, None);

        Self {
            snapshot: ApplicationSnapshot {
                lifecycle: LifecycleState::Created,
                page: PageId::Todos,
                todo_page: 0,
                todos: state.todos,
                todo_sync: state.todo_sync,
                render_revision: 0,
                services: ServiceSnapshot { phases },
                display: DisplaySnapshot {
                    phase: DisplayPhase::Idle,
                    requested_revision: None,
                    displayed_revision: None,
                    skipped_revision: None,
                    failed_revision: None,
                },
                diagnostics: RuntimeDiagnostics::default(),
                network: NetworkSnapshot::default(),
                gallery: GallerySnapshot::default(),
                glance: GlanceSnapshot {
                    calendar_month_offset: 0,
                    weather,
                },
                settings: SettingsSnapshot {
                    selected: 0,
                    item_count: 0,
                    provisioning_requested: false,
                    provisioning: ProvisioningSnapshot::default(),
                },
                config: state.config,
                status: DeviceStatusSnapshot::default(),
            },
        }
    }

    pub fn snapshot(&self) -> &ApplicationSnapshot {
        &self.snapshot
    }

    pub fn persistent_state(&self) -> PersistentState {
        PersistentState {
            config: self.snapshot.config.clone(),
            todos: self.snapshot.todos.clone(),
            weather_cache: self.snapshot.glance.weather.reading.clone(),
            todo_sync: self.snapshot.todo_sync.clone(),
        }
    }

    pub fn start(&mut self) -> Transition {
        if self.snapshot.lifecycle != LifecycleState::Created {
            return Transition::default();
        }

        self.snapshot.lifecycle = LifecycleState::Starting;
        let mut service_requests = Vec::new();
        for service in ServiceId::ALL {
            if self.snapshot.services.phase(service) == ServicePhase::Dormant {
                self.set_service_phase(service, ServicePhase::Starting);
                service_requests.push(ServiceRequest::Start(service));
            }
        }
        self.finish_startup_if_ready();

        Transition {
            render: Some(self.next_render()),
            service_requests,
            power_request: None,
        }
    }

    pub fn dispatch(&mut self, command: ApplicationCommand) -> Transition {
        match command {
            ApplicationCommand::SelectPrevious => self.move_selection(-1),
            ApplicationCommand::SelectNext => self.move_selection(1),
            ApplicationCommand::ActivateSelection => self.activate_selection(),
            ApplicationCommand::Refresh => Transition {
                render: matches!(
                    self.snapshot.lifecycle,
                    LifecycleState::Starting | LifecycleState::Running
                )
                .then(|| self.next_render()),
                ..Transition::default()
            },
            ApplicationCommand::RequestSleep => Transition {
                power_request: Some(PowerRequest::Sleep),
                ..Transition::default()
            },
            ApplicationCommand::ServiceStarted(service) => self.service_started(service),
            ApplicationCommand::ServiceStopped(service) => self.service_stopped(service),
            ApplicationCommand::ServiceFailed(service) => self.service_failed(service),
            ApplicationCommand::Display(event) => self.display_event(event),
            ApplicationCommand::PreviousPage => self.previous_page(),
            ApplicationCommand::NextPage => self.next_page(),
            ApplicationCommand::EnterDiagnostics => self.enter_diagnostics(),
            ApplicationCommand::EnterProvisioning => self.enter_provisioning(),
            ApplicationCommand::DiagnosticsUpdated(diagnostics) => {
                let last_error = self.snapshot.diagnostics.last_error;
                self.snapshot.diagnostics = RuntimeDiagnostics {
                    last_error,
                    ..diagnostics
                };
                Transition::default()
            }
            ApplicationCommand::NetworkUpdated(network) => {
                self.snapshot.network = network;
                Transition::default()
            }
            ApplicationCommand::TodosSynced(todos) => self.todos_synced(todos),
            ApplicationCommand::TodoSyncStatus(status) => {
                self.snapshot.todo_sync = status;
                Transition::default()
            }
            ApplicationCommand::GalleryUpdated(catalog) => self.gallery_updated(catalog),
            ApplicationCommand::EnterGalleryFullscreen => self.enter_gallery_fullscreen(),
            ApplicationCommand::GalleryFrameLoaded(frame) => {
                self.snapshot.gallery.fullscreen_frame = frame;
                Transition::default()
            }
            ApplicationCommand::GalleryFailed(error) => self.gallery_failed(error),
            ApplicationCommand::WeatherFetching => self.mutate(|snapshot| {
                snapshot.glance.weather.fetching();
            }),
            ApplicationCommand::WeatherFetched(reading) => self.mutate(|snapshot| {
                snapshot.glance.weather.fetched(reading);
            }),
            ApplicationCommand::WeatherFailed {
                at_unix_seconds,
                error,
            } => self.mutate(|snapshot| {
                snapshot.glance.weather.failed(at_unix_seconds, error);
            }),
            ApplicationCommand::WeatherClock(now) => {
                self.snapshot.glance.weather.reclassify(now);
                Transition::default()
            }
            ApplicationCommand::ProvisioningUpdated(status) => self.provisioning_updated(status),
            ApplicationCommand::ConfigApplied(config) => self.config_applied(config),
            ApplicationCommand::StatusUpdated(status) => {
                self.snapshot.status = status;
                Transition::default()
            }
            ApplicationCommand::Shutdown => self.shutdown(),
        }
    }

    fn move_selection(&mut self, delta: isize) -> Transition {
        if self.snapshot.page == PageId::Todos {
            let page_count = self.snapshot.todos.items.len().div_ceil(6).max(1);
            if page_count <= 1 {
                return Transition::default();
            }
            return self.mutate(|snapshot| {
                snapshot.todo_page =
                    (snapshot.todo_page as isize + delta).rem_euclid(page_count as isize) as usize;
            });
        }
        if !matches!(self.snapshot.page, PageId::Gallery | PageId::Calendar)
            || (self.snapshot.page == PageId::Gallery
                && self.snapshot.gallery.catalog.assets.is_empty())
        {
            return Transition::default();
        }
        self.mutate(|snapshot| match snapshot.page {
            PageId::Todos => {}
            PageId::Gallery if !snapshot.gallery.catalog.assets.is_empty() => {
                snapshot.gallery.selected = (snapshot.gallery.selected as isize + delta)
                    .rem_euclid(snapshot.gallery.catalog.assets.len() as isize)
                    as usize;
                snapshot.gallery.fullscreen_frame = None;
            }
            PageId::Gallery => {}
            PageId::Calendar => {
                snapshot.glance.calendar_month_offset = snapshot
                    .glance
                    .calendar_month_offset
                    .saturating_add(delta as i16)
                    .clamp(-1_200, 1_200);
            }
            PageId::Weather | PageId::Provisioning => {}
            PageId::Diagnostics => {}
        })
    }

    fn activate_selection(&mut self) -> Transition {
        if !matches!(
            self.snapshot.lifecycle,
            LifecycleState::Starting | LifecycleState::Running
        ) {
            return Transition::default();
        }
        if self.snapshot.page == PageId::Todos {
            return Transition::default();
        }
        if self.snapshot.page == PageId::Diagnostics {
            return self.mutate(|snapshot| snapshot.page = PageId::Todos);
        }
        if self.snapshot.page == PageId::Gallery {
            return self.mutate(|snapshot| {
                if !snapshot.gallery.catalog.assets.is_empty() {
                    snapshot.gallery.fullscreen = !snapshot.gallery.fullscreen;
                    if !snapshot.gallery.fullscreen {
                        snapshot.gallery.fullscreen_frame = None;
                    }
                }
            });
        }
        if self.snapshot.page == PageId::Calendar {
            return self.mutate(|snapshot| snapshot.glance.calendar_month_offset = 0);
        }
        self.mutate(|snapshot| match snapshot.page {
            PageId::Todos => {}
            PageId::Gallery => {}
            PageId::Calendar | PageId::Weather => {}
            PageId::Provisioning => {}
            PageId::Diagnostics => {}
        })
    }

    fn enter_gallery_fullscreen(&mut self) -> Transition {
        if self.snapshot.page != PageId::Gallery
            || self.snapshot.gallery.fullscreen
            || self.snapshot.gallery.catalog.assets.is_empty()
        {
            return Transition::default();
        }
        self.mutate(|snapshot| snapshot.gallery.fullscreen = true)
    }

    fn previous_page(&mut self) -> Transition {
        self.mutate(|snapshot| {
            if snapshot.page == PageId::Gallery && snapshot.gallery.fullscreen {
                snapshot.gallery.fullscreen = false;
                snapshot.gallery.fullscreen_frame = None;
            } else {
                snapshot.page = snapshot.page.previous();
            }
        })
    }

    fn next_page(&mut self) -> Transition {
        self.mutate(|snapshot| {
            if snapshot.page == PageId::Gallery && snapshot.gallery.fullscreen {
                snapshot.gallery.fullscreen = false;
                snapshot.gallery.fullscreen_frame = None;
            } else {
                snapshot.page = snapshot.page.next();
            }
        })
    }

    fn gallery_updated(&mut self, catalog: GalleryCatalog) -> Transition {
        let selected_id = self
            .snapshot
            .gallery
            .catalog
            .assets
            .get(self.snapshot.gallery.selected)
            .map(|asset| asset.id);
        let changed =
            self.snapshot.gallery.catalog != catalog || self.snapshot.gallery.last_error.is_some();
        self.snapshot.gallery.catalog = catalog;
        self.snapshot.gallery.selected = selected_id
            .and_then(|id| {
                self.snapshot
                    .gallery
                    .catalog
                    .assets
                    .iter()
                    .position(|asset| asset.id == id)
            })
            .unwrap_or(0)
            .min(self.snapshot.gallery.catalog.assets.len().saturating_sub(1));
        if self.snapshot.gallery.catalog.assets.is_empty() {
            self.snapshot.gallery.fullscreen = false;
        }
        self.snapshot.gallery.fullscreen_frame = None;
        self.snapshot.gallery.last_error = None;
        Transition {
            render: (changed && self.snapshot.page == PageId::Gallery).then(|| self.next_render()),
            ..Transition::default()
        }
    }

    fn todos_synced(&mut self, todos: TodoModel) -> Transition {
        if self.snapshot.todos == todos {
            return Transition::default();
        }
        self.snapshot.todos = todos;
        self.snapshot.todo_page = self.snapshot.todo_page.min(
            self.snapshot
                .todos
                .items
                .len()
                .div_ceil(6)
                .saturating_sub(1),
        );
        Transition {
            render: (self.snapshot.page == PageId::Todos).then(|| self.next_render()),
            ..Transition::default()
        }
    }

    fn gallery_failed(&mut self, error: String) -> Transition {
        if self.snapshot.gallery.last_error.as_ref() == Some(&error) {
            return Transition::default();
        }
        self.snapshot.gallery.fullscreen = false;
        self.snapshot.gallery.fullscreen_frame = None;
        self.snapshot.gallery.last_error = Some(error);
        Transition {
            render: (self.snapshot.page == PageId::Gallery).then(|| self.next_render()),
            ..Transition::default()
        }
    }

    fn enter_provisioning(&mut self) -> Transition {
        self.mutate(|snapshot| {
            snapshot.page = PageId::Provisioning;
            snapshot.settings.provisioning_requested = true;
        })
    }

    fn enter_diagnostics(&mut self) -> Transition {
        self.mutate(|snapshot| snapshot.page = PageId::Diagnostics)
    }

    fn provisioning_updated(&mut self, status: ProvisioningSnapshot) -> Transition {
        if self.snapshot.settings.provisioning == status {
            return Transition::default();
        }
        self.mutate(|snapshot| {
            snapshot.settings.provisioning_requested = status.phase != ProvisioningPhase::Idle;
            snapshot.settings.provisioning = status;
            if status.phase == ProvisioningPhase::Idle && snapshot.page == PageId::Provisioning {
                snapshot.page = PageId::Todos;
            }
        })
    }

    fn config_applied(&mut self, config: DeviceConfig) -> Transition {
        if self.snapshot.config == config {
            return Transition::default();
        }
        let network_changed = self.snapshot.config.wifi != config.wifi
            || self.snapshot.config.local_management != config.local_management;
        let weather_location_changed = self.snapshot.config.weather.latitude_e6
            != config.weather.latitude_e6
            || self.snapshot.config.weather.longitude_e6 != config.weather.longitude_e6;
        if weather_location_changed {
            self.snapshot.glance.weather = WeatherSnapshot::default();
        }
        self.snapshot
            .glance
            .weather
            .set_enabled(config.weather.enabled, None);
        self.snapshot.config = config;
        let mut transition = Transition {
            render: Some(self.next_render()),
            ..Transition::default()
        };
        if network_changed
            && self.snapshot.services.phase(ServiceId::Network) != ServicePhase::Disabled
        {
            transition
                .service_requests
                .push(ServiceRequest::Reconfigure(ServiceId::Network));
        }
        transition
    }

    fn mutate(&mut self, mutate: impl FnOnce(&mut ApplicationSnapshot)) -> Transition {
        if !matches!(
            self.snapshot.lifecycle,
            LifecycleState::Starting | LifecycleState::Running
        ) {
            return Transition::default();
        }

        mutate(&mut self.snapshot);
        Transition {
            render: Some(self.next_render()),
            service_requests: Vec::new(),
            power_request: None,
        }
    }

    fn service_started(&mut self, service: ServiceId) -> Transition {
        if self.snapshot.services.phase(service) != ServicePhase::Starting {
            return Transition::default();
        }

        self.set_service_phase(service, ServicePhase::Running);
        let lifecycle_changed = self.finish_startup_if_ready();
        Transition {
            render: lifecycle_changed.then(|| self.next_render()),
            service_requests: Vec::new(),
            power_request: None,
        }
    }

    fn service_stopped(&mut self, service: ServiceId) -> Transition {
        if self.snapshot.services.phase(service) != ServicePhase::Stopping {
            return Transition::default();
        }

        self.set_service_phase(service, ServicePhase::Stopped);
        if ServiceId::ALL.into_iter().all(|candidate| {
            matches!(
                self.snapshot.services.phase(candidate),
                ServicePhase::Disabled | ServicePhase::Stopped
            )
        }) {
            self.snapshot.lifecycle = LifecycleState::Stopped;
        }
        Transition::default()
    }

    fn service_failed(&mut self, service: ServiceId) -> Transition {
        if self.snapshot.services.phase(service) == ServicePhase::Disabled {
            return Transition::default();
        }

        self.set_service_phase(service, ServicePhase::Failed);
        self.snapshot.diagnostics.last_error = Some(service.error_label());
        self.snapshot.lifecycle = LifecycleState::Failed;
        Transition {
            render: Some(self.next_render()),
            service_requests: Vec::new(),
            power_request: None,
        }
    }

    fn shutdown(&mut self) -> Transition {
        if matches!(
            self.snapshot.lifecycle,
            LifecycleState::Stopping | LifecycleState::Stopped
        ) {
            return Transition::default();
        }

        self.snapshot.lifecycle = LifecycleState::Stopping;
        let mut service_requests = Vec::new();
        for service in ServiceId::ALL.into_iter().rev() {
            if matches!(
                self.snapshot.services.phase(service),
                ServicePhase::Starting | ServicePhase::Running | ServicePhase::Failed
            ) {
                self.set_service_phase(service, ServicePhase::Stopping);
                service_requests.push(ServiceRequest::Stop(service));
            }
        }
        if service_requests.is_empty() {
            self.snapshot.lifecycle = LifecycleState::Stopped;
        }

        Transition {
            render: None,
            service_requests,
            power_request: None,
        }
    }

    fn display_event(&mut self, event: DisplayEvent) -> Transition {
        match event {
            DisplayEvent::Busy { revision, .. } => {
                self.snapshot.display.phase = DisplayPhase::Busy;
                self.snapshot.display.requested_revision = Some(revision);
            }
            DisplayEvent::Completed { revision } => {
                self.snapshot.display.phase = DisplayPhase::Idle;
                self.snapshot.display.displayed_revision = Some(revision);
            }
            DisplayEvent::Skipped { revision } => {
                self.snapshot.display.skipped_revision = Some(revision);
            }
            DisplayEvent::Delayed { revision, .. } => {
                if self.snapshot.display.phase != DisplayPhase::Busy {
                    self.snapshot.display.phase = DisplayPhase::Delayed;
                }
                self.snapshot.display.requested_revision = Some(revision);
            }
            DisplayEvent::Failed { revision } => {
                self.snapshot.display.phase = DisplayPhase::Failed;
                self.snapshot.display.failed_revision = Some(revision);
            }
        }
        Transition::default()
    }

    fn finish_startup_if_ready(&mut self) -> bool {
        let ready = ServiceId::ALL.into_iter().all(|service| {
            matches!(
                self.snapshot.services.phase(service),
                ServicePhase::Disabled | ServicePhase::Running
            )
        });
        if ready && self.snapshot.lifecycle == LifecycleState::Starting {
            self.snapshot.lifecycle = LifecycleState::Running;
            true
        } else {
            false
        }
    }

    fn set_service_phase(&mut self, service: ServiceId, phase: ServicePhase) {
        self.snapshot.services.phases[service.index()] = phase;
    }

    fn next_render(&mut self) -> RenderIntent {
        self.snapshot.render_revision = self.snapshot.render_revision.saturating_add(1);
        RenderIntent {
            page: self.snapshot.page,
            revision: self.snapshot.render_revision,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glance::WeatherCondition;
    use crate::model::{Status, TodoId, TodoItem};

    #[test]
    fn startup_and_shutdown_scope_enabled_services() {
        let mut application = Application::new([
            ServiceId::Display,
            ServiceId::Persistence,
            ServiceId::Network,
        ]);

        let startup = application.start();
        assert_eq!(
            startup.service_requests,
            vec![
                ServiceRequest::Start(ServiceId::Display),
                ServiceRequest::Start(ServiceId::Persistence),
                ServiceRequest::Start(ServiceId::Network),
            ]
        );
        assert_eq!(application.snapshot().lifecycle, LifecycleState::Starting);

        for service in [
            ServiceId::Display,
            ServiceId::Persistence,
            ServiceId::Network,
        ] {
            application.dispatch(ApplicationCommand::ServiceStarted(service));
        }
        assert_eq!(application.snapshot().lifecycle, LifecycleState::Running);

        let shutdown = application.dispatch(ApplicationCommand::Shutdown);
        assert_eq!(
            shutdown.service_requests,
            vec![
                ServiceRequest::Stop(ServiceId::Network),
                ServiceRequest::Stop(ServiceId::Persistence),
                ServiceRequest::Stop(ServiceId::Display),
            ]
        );
        for service in [
            ServiceId::Network,
            ServiceId::Persistence,
            ServiceId::Display,
        ] {
            application.dispatch(ApplicationCommand::ServiceStopped(service));
        }
        assert_eq!(application.snapshot().lifecycle, LifecycleState::Stopped);
    }

    #[test]
    fn todo_navigation_is_read_only_and_sync_replaces_the_snapshot() {
        let mut application = Application::new([ServiceId::Display]);
        application.start();
        application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Display));
        let activate = application.dispatch(ApplicationCommand::ActivateSelection);
        assert!(activate.render.is_none());

        let synced = TodoModel {
            items: vec![TodoItem {
                id: TodoId("remote-100".into()),
                title: "Synced from Memorilo".into(),
                due: "today".into(),
                status: Status::Open,
                indent: 0,
            }],
        };
        let transition = application.dispatch(ApplicationCommand::TodosSynced(synced.clone()));
        assert_eq!(application.snapshot().todos, synced);
        assert!(transition.render.is_some());
    }

    #[test]
    fn todo_short_navigation_changes_page_without_mutating_items() {
        let mut application = Application::new([ServiceId::Display]);
        application.start();
        application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Display));
        let mut todos = TodoModel::default();
        let extra = todos.items.clone();
        todos.items.extend(extra);
        application.dispatch(ApplicationCommand::TodosSynced(todos.clone()));

        application.dispatch(ApplicationCommand::SelectNext);
        assert_eq!(application.snapshot().todo_page, 1);
        assert_eq!(application.snapshot().todos, todos);
        application.dispatch(ApplicationCommand::SelectPrevious);
        assert_eq!(application.snapshot().todo_page, 0);
    }

    #[test]
    fn service_failure_is_visible_in_the_application_snapshot() {
        let mut application = Application::new([ServiceId::Display]);
        application.start();

        let failed = application.dispatch(ApplicationCommand::ServiceFailed(ServiceId::Display));

        assert_eq!(application.snapshot().lifecycle, LifecycleState::Failed);
        assert_eq!(
            application.snapshot().services.phase(ServiceId::Display),
            ServicePhase::Failed
        );
        assert!(failed.render.is_some());
    }

    #[test]
    fn network_configuration_changes_request_one_service_reconfigure() {
        let mut application = Application::new([ServiceId::Network]);
        application.start();
        application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Network));
        let mut config = application.snapshot().config.clone();
        config.wifi.set_ssid(Some("Office".into())).unwrap();
        config.wifi.set_password("password-123").unwrap();

        let transition = application.dispatch(ApplicationCommand::ConfigApplied(config));
        assert_eq!(
            transition.service_requests,
            vec![ServiceRequest::Reconfigure(ServiceId::Network)]
        );
        assert!(transition.render.is_some());
    }

    #[test]
    fn changing_weather_location_invalidates_the_runtime_cache() {
        let mut state = PersistentState::default();
        state.config.weather.enabled = true;
        state.weather_cache = Some(WeatherReading {
            is_demo: false,
            observed_at_unix_seconds: 1,
            fetched_at_unix_seconds: 2,
            temperature_tenths_celsius: 200,
            apparent_temperature_tenths_celsius: 200,
            relative_humidity_percent: 50,
            precipitation_probability_percent: 10,
            condition: WeatherCondition::Clear,
        });
        let mut application = Application::with_state([], state);
        application.start();
        assert!(application.snapshot().glance.weather.reading.is_some());

        let mut config = application.snapshot().config.clone();
        config.weather.latitude_e6 = 31_230_400;
        config.weather.longitude_e6 = 121_473_700;
        application.dispatch(ApplicationCommand::ConfigApplied(config));

        assert!(application.snapshot().glance.weather.reading.is_none());
        assert!(application.persistent_state().weather_cache.is_none());
    }

    #[test]
    fn display_events_update_status_without_requesting_recursive_renders() {
        let mut application = Application::new([ServiceId::Display]);
        application.start();
        application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Display));

        let transition = application.dispatch(ApplicationCommand::Display(DisplayEvent::Busy {
            revision: 4,
            delta: Default::default(),
        }));
        assert_eq!(application.snapshot().display.phase, DisplayPhase::Busy);
        assert_eq!(application.snapshot().display.requested_revision, Some(4));
        assert!(transition.render.is_none());

        application.dispatch(ApplicationCommand::Display(DisplayEvent::Completed {
            revision: 4,
        }));
        assert_eq!(application.snapshot().display.phase, DisplayPhase::Idle);
        assert_eq!(application.snapshot().display.displayed_revision, Some(4));
    }

    #[test]
    fn page_navigation_skips_device_settings_and_provisioning_is_explicit() {
        let mut application = Application::new([]);
        application.start();

        application.dispatch(ApplicationCommand::NextPage);
        assert_eq!(application.snapshot().page, PageId::Gallery);
        application.dispatch(ApplicationCommand::NextPage);
        assert_eq!(application.snapshot().page, PageId::Calendar);
        application.dispatch(ApplicationCommand::NextPage);
        assert_eq!(application.snapshot().page, PageId::Weather);
        application.dispatch(ApplicationCommand::NextPage);
        assert_eq!(application.snapshot().page, PageId::Todos);
        application.dispatch(ApplicationCommand::PreviousPage);
        assert_eq!(application.snapshot().page, PageId::Weather);
        application.dispatch(ApplicationCommand::NextPage);
        application.dispatch(ApplicationCommand::EnterProvisioning);
        assert_eq!(application.snapshot().page, PageId::Provisioning);
        assert!(application.snapshot().settings.provisioning_requested);
    }

    #[test]
    fn gallery_selection_and_fullscreen_survive_catalog_reordering_by_id() {
        use crate::gallery::{GalleryAssetId, GalleryAssetMetadata, GalleryCatalog};

        let asset = |id, name: &str| GalleryAssetMetadata {
            id: GalleryAssetId(id),
            name: name.into(),
            created_at_unix_seconds: 0,
            checksum: id as u32,
            byte_length: crate::framebuffer::FRAME_BYTES as u32,
        };
        let mut application = Application::new([]);
        application.start();
        application.dispatch(ApplicationCommand::GalleryUpdated(GalleryCatalog {
            assets: vec![asset(1, "one"), asset(2, "two")],
            slideshow_interval_seconds: None,
        }));
        application.dispatch(ApplicationCommand::NextPage);
        application.dispatch(ApplicationCommand::SelectNext);
        application.dispatch(ApplicationCommand::ActivateSelection);
        assert!(application.snapshot().gallery.fullscreen);

        application.dispatch(ApplicationCommand::GalleryUpdated(GalleryCatalog {
            assets: vec![asset(2, "two"), asset(1, "one")],
            slideshow_interval_seconds: None,
        }));
        assert_eq!(application.snapshot().gallery.selected, 0);
        application.dispatch(ApplicationCommand::NextPage);
        assert_eq!(application.snapshot().page, PageId::Gallery);
        assert!(!application.snapshot().gallery.fullscreen);
    }

    #[test]
    fn gallery_idle_fullscreen_keeps_navigation_and_boot_exits() {
        use crate::gallery::{GalleryAssetId, GalleryAssetMetadata, GalleryCatalog};

        let asset = |id, name: &str| GalleryAssetMetadata {
            id: GalleryAssetId(id),
            name: name.into(),
            created_at_unix_seconds: 0,
            checksum: id as u32,
            byte_length: crate::framebuffer::FRAME_BYTES as u32,
        };
        let mut application = Application::new([]);
        application.start();

        assert!(
            application
                .dispatch(ApplicationCommand::EnterGalleryFullscreen)
                .render
                .is_none()
        );
        application.dispatch(ApplicationCommand::GalleryUpdated(GalleryCatalog {
            assets: vec![asset(1, "one"), asset(2, "two")],
            slideshow_interval_seconds: None,
        }));
        application.dispatch(ApplicationCommand::NextPage);

        let entered = application.dispatch(ApplicationCommand::EnterGalleryFullscreen);
        assert!(entered.render.is_some());
        assert!(application.snapshot().gallery.fullscreen);

        application.dispatch(ApplicationCommand::SelectNext);
        assert_eq!(application.snapshot().gallery.selected, 1);
        assert!(application.snapshot().gallery.fullscreen);
        application.dispatch(ApplicationCommand::SelectPrevious);
        assert_eq!(application.snapshot().gallery.selected, 0);
        assert!(application.snapshot().gallery.fullscreen);

        application.dispatch(ApplicationCommand::ActivateSelection);
        assert!(!application.snapshot().gallery.fullscreen);
    }

    #[test]
    fn calendar_navigation_is_bounded_and_confirm_returns_to_current_month() {
        let mut application = Application::new([]);
        application.start();
        application.dispatch(ApplicationCommand::NextPage);
        application.dispatch(ApplicationCommand::NextPage);
        assert_eq!(application.snapshot().page, PageId::Calendar);
        application.dispatch(ApplicationCommand::SelectNext);
        application.dispatch(ApplicationCommand::SelectNext);
        assert_eq!(application.snapshot().glance.calendar_month_offset, 2);
        application.dispatch(ApplicationCommand::ActivateSelection);
        assert_eq!(application.snapshot().glance.calendar_month_offset, 0);
    }

    #[test]
    fn diagnostics_is_deliberate_and_exits_back_to_todos() {
        let mut application = Application::new([]);
        application.start();
        application.dispatch(ApplicationCommand::NextPage);
        application.dispatch(ApplicationCommand::DiagnosticsUpdated(
            RuntimeDiagnostics::sample([false, true, false], "ok-long"),
        ));

        let entered = application.dispatch(ApplicationCommand::EnterDiagnostics);
        assert_eq!(application.snapshot().page, PageId::Diagnostics);
        assert_eq!(application.snapshot().diagnostics.last_input, "ok-long");
        assert!(entered.render.is_some());

        application.dispatch(ApplicationCommand::ActivateSelection);
        assert_eq!(application.snapshot().page, PageId::Todos);
    }
}
