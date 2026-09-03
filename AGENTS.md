## Project organization

Memorilo is an Electron application organized as a pnpm and Turbo monorepo.

- `apps/desktop` coordinates Electron development and production builds.
- `apps/desktop/main` owns the Electron main process and composes IPC services with persistence adapters.
- `apps/desktop/preload` owns the context-isolated renderer bridge and exposed contracts.
- `apps/desktop/renderer` owns the React application and browser-facing state.
- `packages/editor` owns reusable editor UI, state, extensions, and integrations.
- `packages/editor-storage` owns the platform-independent persistence workflow, SQLite schema, CRDT snapshot persistence, node projections, and search.
- Platform packages provide database-driver and embedding-model adapters to `packages/editor-storage`.
- `apps/desktop/e2e` owns Playwright Electron end-to-end tests.

Import packages through their public entry points. Do not reach into another package's private source tree.

## Component architecture

- `packages/ui` owns public, cross-feature controls and their semantic visual contract. Import them through `@memorilo/ui`; do not reach into another package's component files.
- Keep domain semantics and feature-specific interaction in the owning feature. Promote a component only when its behavior and accessibility contract are stable across multiple features; move the public component and its styles together, then remove the absorbed private API.
- Keep `apps/desktop/renderer/src/routes` limited to TanStack Router route modules. Route modules declare and wire routes; place page implementations, StyleX modules, view models, and other helpers under the owning `features/<feature>` directory.
- Build shared controls for composition. Prefer compound APIs (`Root`, `Trigger`, `Content`, `Item`, and similar) when a control has meaningful subparts; use `asChild` only when the caller must provide the semantic element and the resulting element still forwards refs, keyboard behavior, and ARIA attributes correctly.
- Keep the public API small: expose semantic variants and slots for real layout differences, not feature flags for unrelated workflows. Pass `xstyle` for local composition; keep structural rules and states in the component's `*.stylex.ts` file.
- `packages/ui/src/theme.stylex.ts` owns shared semantic tokens and theme presets. Shared styles consume tokens rather than raw colors, shadows, or surfaces, so a theme may change the visual language substantially without feature edits. Apply the selected theme at renderer composition roots.
- Feature-only styles may use feature tokens and remain local. Third-party/editor integration styles, positioning adapters, and lifecycle-specific behavior stay at their integration boundary instead of leaking into `packages/ui`.
- Keep pure synchronous view-model calculations in ordinary TypeScript. Components coordinate React state, events, and rendering; place Effect programs behind the asynchronous, resource, or service boundary described below.
- Preserve native semantics and observable states: forward native props and refs, expose `data-ui`, `data-variant`, and `data-state` where useful, and make focus, dismissal, reduced motion, and disabled behavior part of the component contract.
- When changing a shared control, inspect every public consumer, update the component and its StyleX module together, and run the affected package's lint, typecheck, and focused tests before broader repository gates.

## Effect-TS and reuse

- Use Effect as the default orchestration model for cross-layer asynchronous work and external effects: persistence and database access, IPC and P2P calls, filesystem or network I/O, Electron lifecycle resources, cancellation, timeouts, retries, and recovery. Keep the returned effect composable, and call `Effect.runPromise` or the app runtime only at the owning execution boundary.
- Model failures as typed, discriminated errors with stable codes or tags, using `Data.TaggedError` when it fits the package's existing contracts. Convert unknown exceptions at the boundary with `Effect.try` or `Effect.tryPromise`, preserve the cause for diagnostics, and map domain failures to localized UI messages only in the UI layer.
- Represent dependencies as small services and compose them with `Context` and `Layer`. Inject database handles, clients, clocks, filesystem adapters, and Electron resources instead of constructing them inside business functions; this keeps implementations replaceable and makes shared behavior reusable across main, preload, renderer, and package code.
- Use `Effect.acquireUseRelease` or a scoped `Layer` for every resource with a lifetime. Tie listeners, windows, connections, workers, and temporary files to that scope so cleanup runs on success, failure, and interruption.
- Express workflows with `Effect.gen` and named service operations. Compose independent work with `Effect.all` and an explicit concurrency policy; use `Schedule` for bounded retry and backoff, and propagate interruption so obsolete UI requests do not continue doing I/O.
- Extract a shared service or combinator when multiple features repeat loading, error mapping, retry, caching, or lifecycle code. Reuse one Layer/service instance for hot paths, and document cache invalidation or lifetime boundaries whenever reuse changes observable behavior.
- Keep Effect at a meaningful boundary: represent pure validation, synchronous calculations, React rendering, and simple event handlers in ordinary TypeScript. Add an Effect abstraction when it removes real duplication or makes a resource, dependency, concurrency, or error contract explicit.
- Before adding a parallel implementation, search public package APIs and existing Effect services for a reusable operation. Extend the owning service contract when the behavior is cross-feature; consume it through public package entry points and keep feature-specific policy in the feature.

## Development commands

Run commands from the repository root unless stated otherwise.

- Install dependencies: `pnpm install`
- Start Electron development: `pnpm dev`
- Build all packages: `pnpm build`
- Lint all packages: `pnpm lint`
- Type-check all packages: `pnpm typecheck`
- Run unit and component tests: `pnpm test`
- Run Electron end-to-end tests: `pnpm test:e2e`

Electron E2E tests must set `MEMORILO_E2E_HIDE_WINDOW=1` when launching the app so tests do not show a native window. Do not set this variable for normal development or production launches.

Use Turbo filters when working on a specific package:

- Editor tests: `pnpm turbo run test --filter=@memorilo/editor`
- Desktop build and dependencies: `pnpm turbo run build --filter=@memorilo/desktop...`
- Main-process tests: `pnpm turbo run test --filter=@memorilo/desktop-main`
- Renderer tests: `pnpm turbo run test --filter=@memorilo/desktop-renderer`
- Preload tests: `pnpm turbo run test --filter=@memorilo/desktop-preload`

## Internationalization

- Locale resources live at `locales/<namespace>/<language>.json`. Keep every supported language in a namespace structurally aligned: adding, renaming, or removing a key requires the same change in every language file.
- The desktop renderer owns production i18next initialization in `apps/desktop/renderer/src/i18n`. Add supported languages and namespaces in `locales.ts`; do not initialize a second i18next instance in renderer or editor production code.
- `packages/editor` consumes the renderer's shared i18next instance. Its `src/i18n/init.ts` helper is for isolated editor tests only and must load the real root locale bundles.
- React components should call `useTranslation('<namespace>')` and render through the returned `t`. When multiple namespaces are needed, declare all of them and use an explicit `ns` for cross-namespace keys.
- Non-React UI such as ProseMirror NodeViews may call `i18next.t(key, { ns })`, but persistent DOM must subscribe to `languageChanged` and unsubscribe on destroy, or use a language-dependent decoration/widget key that guarantees reconstruction.
- Translate at the UI boundary. Domain and persistence code should return structured error/status codes rather than localized strings or translation keys intended for direct display.
- Use i18next JSON v4/CLDR plural suffixes such as `_one` and `_other`; do not add legacy `_plural` keys.
- Locale-aware Day.js formats (`L`, `LL`, `lll`, and related tokens) rely on the renderer's `LocalizedFormat` setup. Change application language through `setI18nLanguage` so the Day.js locale is applied before i18next emits `languageChanged`; do not call `dayjs.locale` or `i18next.changeLanguage` independently from feature code.
- Renderer development hot-reloads root locale JSON through the Vite configuration. Keep locale paths repository-relative and ensure production bundles do not contain `/@fs` URLs or local absolute paths.
- After i18n changes, at minimum run targeted lint, type checking, and tests for affected packages. For renderer loading, locale HMR, language persistence, or runtime switching, also run the relevant Electron E2E coverage and a production desktop build.

## Dependency modifications

- Do not add or modify dependency patches (`pnpm patch`, `patchedDependencies`, `patch-package`, or equivalent) unless the user explicitly requests a patch.
- When a dependency defect appears to require patching, report the defect and ask the user how to proceed before changing dependency patch configuration or files.

## Debugging and verification

- Reproduce issues with the smallest relevant package command before running the full workspace suite.
- Use `pnpm dev` for interactive Electron debugging.
- After changing a package, run its targeted tests, lint, and type checking first.
- Before considering repository-wide work complete, run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- Run `pnpm test:e2e` for changes affecting Electron startup, IPC, preload contracts, persistence, packaging, or end-user workflows.
- Rebuild native Electron dependencies after changing Electron or native modules with `pnpm --filter @memorilo/desktop rebuild:native`.
- Keep database schema and queries inside `packages/editor-storage`; compose that module with platform adapters in the Electron main process.
- Review editor-storage schema changes before opening an existing database.
- A comment states the non-obvious reason at the owning boundary. Include a constraint or invalidation condition only when a maintainer needs it to know when the rationale or code stops being valid. Do not restate the operation, preserve intermediate attempts, or list speculative future work.

## Design skills

Use the `apple-design` skill when building or reviewing:

- Gesture-driven interactions such as drag, swipe, sheets, and direct manipulation.
- Spring animations, momentum, interruption, and velocity-aware transitions.
- Translucent materials, depth, typography, and Apple-style interface polish.
- Reduced-motion behavior and accessibility for animated interactions.
- UI work where responsiveness, spatial consistency, feedback, or restraint materially affects the experience.
- No blue background, no gnome-style control, no translucent glass
- Reference liquid glass design language, search its documentation and video if you cannot get related style.

Do not invoke it for routine non-visual changes where these design concerns do not apply.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a multi-context domain documentation layout. See `docs/agents/domain.md`.

### ESP-IDF flashing

For ESP32 real-device build, flash, recovery, or serial-monitor work, use the
`esp-idf-flashing` skill and follow `docs/agents/esp-idf-flashing.md`.
