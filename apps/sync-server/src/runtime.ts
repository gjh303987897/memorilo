import type { SyncObjectStore, SyncRepository } from '@memorilo/sync'
import type { Server } from 'node:http'
import type { SyncServerPeer } from '../infrastructure/p2p/server-peer'
import type { SyncServerConfig } from './config'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createResourceScope } from '@memorilo/effect-lifecycle'
import { createPostgresSyncDatabase } from '../infrastructure/database/postgres'
import { createSqliteSyncDatabase } from '../infrastructure/database/sqlite'
import { createFilesystemObjectStore } from '../infrastructure/object-store/filesystem'
import { createS3ObjectStore } from '../infrastructure/object-store/s3'
import { createSyncServerPeer, rebuildAuthoritativeState } from '../infrastructure/p2p/server-peer'
import { createSyncServerApp } from './app'
import { createDeviceTodoModule } from './device-todo'
import { createSyncServerMetrics } from './metrics'
import { createOrphanWorker } from './orphan-worker'
import { createResetWorker } from './reset-worker'
import { loadSyncServerWebRenderer } from './web-renderer'

export interface SyncServerRuntime {
  readonly app: ReturnType<typeof createSyncServerApp>
  readonly objectStore: SyncObjectStore
  readonly repository: SyncRepository
  readonly peer: SyncServerPeer
  readonly beginDrain: () => Promise<void>
  readonly close: () => Promise<void>
}

function requireConfigured(value: string | undefined, message: string): string {
  if (value === undefined)
    throw new Error(message)
  return value
}

export async function createSyncServerRuntime(config: SyncServerConfig, options: { readonly httpServer: Server, readonly port: number }): Promise<SyncServerRuntime> {
  const scope = createResourceScope('Sync server')
  let ready = false
  let stopWorkers: (() => Promise<void>) | null = null
  try {
    await mkdir(config.dataDir, { recursive: true })
    const database = (await scope.acquire({
      acquire: () => config.metadataDatabase === 'sqlite'
        ? createSqliteSyncDatabase({ filename: join(config.dataDir, 'sync.sqlite') })
        : createPostgresSyncDatabase({ url: requireConfigured(config.postgresUrl, 'PostgreSQL metadata provider requires a connection URL') }),
      close: current => current.close(),
      name: 'metadata database',
    })).resource
    await database.migrate()
    for (const account of await database.repository.listAccountStates())
      await rebuildAuthoritativeState(database.repository, account)
    const metrics = createSyncServerMetrics()
    const objectStore = (await scope.acquire({
      acquire: () => config.objectStore === 'filesystem'
        ? createFilesystemObjectStore({ root: config.filesystemRoot ?? join(config.dataDir, 'objects') })
        : createS3ObjectStore({
            accessKeyId: config.s3AccessKeyId,
            bucket: requireConfigured(config.s3Bucket, 'S3 object provider requires a bucket'),
            endpoint: config.s3Endpoint,
            forcePathStyle: config.s3ForcePathStyle,
            region: config.s3Region,
            secretAccessKey: config.s3SecretAccessKey,
          }),
      close: store => store.close(),
      name: 'object store',
    })).resource
    await objectStore.verify()
    if (config.maintenanceMode !== 'read-only') {
      const resetWorker = (await scope.acquire({
        acquire: () => createResetWorker({ metrics: metrics.peerRecorder, objectStore, repository: database.repository }),
        close: worker => worker.close(),
        name: 'reset worker',
      })).resource
      const orphanWorker = (await scope.acquire({
        acquire: () => createOrphanWorker({
          graceMs: config.orphanGraceMs,
          intervalMs: config.orphanIntervalMs,
          objectStore,
          repository: database.repository,
        }),
        close: worker => worker.close(),
        name: 'orphan reconciliation worker',
      })).resource
      let workersStopped = false
      stopWorkers = async () => {
        if (workersStopped)
          return
        workersStopped = true
        await Promise.allSettled([resetWorker.close(), orphanWorker.close()])
      }
    }
    const peer = (await scope.acquire({
      acquire: () => createSyncServerPeer({
        auth: database.auth,
        listenAddress: `/ip4/127.0.0.1/tcp/${options.port}/ws`,
        sharedWebSocketServer: options.httpServer,
        enabledModes: config.enabledModes,
        isAccepting: () => ready,
        maxObjectTransfersPerAccount: config.maxObjectTransfersPerAccount,
        maxSyncSessionsPerAccount: config.maxSyncSessionsPerAccount,
        objectStore,
        readOnly: config.maintenanceMode === 'read-only',
        repository: database.repository,
        sessionIdleTimeoutMs: config.sessionIdleTimeoutMs,
        sessionTotalTimeoutMs: config.sessionTotalTimeoutMs,
        statePath: join(config.dataDir, 'peer', 'identity.json'),
        metrics: metrics.peerRecorder,
      }),
      close: current => current.close(),
      name: 'sync peer',
    })).resource
    const webRootUrl = new URL('../dist/', import.meta.url)
    const webRenderer = await loadSyncServerWebRenderer(new URL('../dist-ssr/server.js', import.meta.url))
    const app = createSyncServerApp(config, {
      audit: database.audit,
      auth: database.auth,
      closeAccountSyncSessions: peer.closeAccountSessions,
      closeDeviceSyncSessions: peer.closeDeviceSessions,
      isReady: () => ready,
      metrics,
      peer: peer.application,
      peerMetrics: () => metrics.snapshot(peer.metrics()),
      renderWeb: webRenderer.render,
      repository: database.repository,
      deviceTodo: createDeviceTodoModule({ repository: database.repository, store: database.deviceTodo }),
      webRoot: fileURLToPath(webRootUrl),
    })
    scope.commit()
    ready = true
    return {
      app,
      beginDrain: async () => {
        if (!ready)
          return
        ready = false
        await stopWorkers?.()
        await peer.drain()
      },
      close: scope.close,
      objectStore,
      peer,
      repository: database.repository,
    }
  }
  catch (error) {
    return scope.rollback(error)
  }
}
