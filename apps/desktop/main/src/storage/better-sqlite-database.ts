import type {
  DatabaseCommand,
  EditorStorageDatabase,
} from '@memorilo/editor-storage'
import type Database from 'better-sqlite3'
import { accessSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editorStorageDrizzleSchema } from '@memorilo/editor-storage'
import BetterSqlite3 from 'better-sqlite3'
import { count } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator'
import { sqliteTable } from 'drizzle-orm/sqlite-core'
import { getLoadablePath as getSqliteVecPath } from 'sqlite-vec'

const drizzleMigrations = sqliteTable('__drizzle_migrations', {})

function unpackedAsarPath(path: string): string {
  return path.replace(/([\\/])app\.asar([\\/])/u, '$1app.asar.unpacked$2')
}

function editorStorageMigrationsPath(): string {
  const candidates = [
    new URL('../../../../../packages/editor-storage/drizzle', import.meta.url),
    new URL('../../node_modules/@memorilo/editor-storage/drizzle', import.meta.url),
    new URL('../../../editor-storage-migrations', import.meta.url),
  ]
  for (const candidate of candidates) {
    const path = resolve(fileURLToPath(candidate))
    try {
      accessSync(path)
      return path
    }
    catch {
      // Try the next layout; development and packaged Electron use different roots.
    }
  }
  throw new Error('Editor storage Drizzle migrations are not packaged')
}

export interface BetterSqliteDatabaseOptions {
  loadVectorExtension?: boolean
}

export class BetterSqliteDatabase implements EditorStorageDatabase {
  readonly #database: Database.Database
  readonly #drizzle
  get drizzle() {
    return this.#drizzle
  }

  #closed = false
  #migrated = false

  constructor(path: string, options: BetterSqliteDatabaseOptions = {}) {
    if (path.length === 0)
      throw new TypeError('Database path must be a non-empty string')

    const database = new BetterSqlite3(path)
    try {
      if (options.loadVectorExtension !== false)
        database.loadExtension(unpackedAsarPath(getSqliteVecPath()))
      database.pragma('foreign_keys = ON')
      database.pragma('busy_timeout = 5000')
      database.pragma('journal_mode = WAL')
    }
    catch (error) {
      database.close()
      throw error
    }
    this.#database = database
    this.#drizzle = drizzle(database, { schema: editorStorageDrizzleSchema })
  }

  migrate(): void {
    this.#assertOpen()
    if (this.#migrated)
      return
    const migrationsFolder = editorStorageMigrationsPath()
    migrateDrizzle(this.#drizzle, { migrationsFolder })
    const state = this.#drizzle.select({ generation: count() })
      .from(drizzleMigrations)
      .get()
    if (!state || !Number.isSafeInteger(state.generation) || state.generation < 1)
      throw new Error('Drizzle migrations did not establish a valid schema generation')
    this.#database.pragma(`user_version = ${state.generation}`)
    this.#migrated = true
  }

  async backup(destinationPath: string): Promise<void> {
    this.#assertOpen()
    await this.#database.backup(destinationPath)
  }

  async batch(commands: readonly DatabaseCommand[]): Promise<void> {
    this.#assertOpen()
    const execute = this.#database.transaction(() => {
      for (const command of commands)
        command.drizzle(this.#drizzle)
    })
    execute()
  }

  async close(): Promise<void> {
    if (this.#closed)
      return
    this.#closed = true
    this.#database.close()
  }

  async executeInfrastructureSql(sql: string): Promise<void> {
    this.#assertOpen()
    this.#database.exec(sql)
  }

  #assertOpen(): void {
    if (this.#closed)
      throw new Error('The SQLite database is closed')
  }
}
