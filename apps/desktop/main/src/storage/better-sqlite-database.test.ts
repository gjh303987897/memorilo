import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { afterEach, describe, expect, it } from 'vitest'
import { BetterSqliteDatabase } from './better-sqlite-database'

const records = sqliteTable('records', {
  id: integer().primaryKey(),
  value: text().notNull(),
})

const databases: BetterSqliteDatabase[] = []

function createDatabase(): BetterSqliteDatabase {
  const database = new BetterSqliteDatabase(':memory:')
  databases.push(database)
  return database
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(database => database.close()))
})

describe('better-sqlite editor storage database', () => {
  it('rolls back the whole batch when one command fails', async () => {
    const database = createDatabase()
    database.drizzle.run(sql`CREATE TABLE ${records} (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`)

    await expect(database.batch([
      { drizzle: orm => orm.insert(records).values({ id: 1, value: 'first' }).run() },
      { drizzle: orm => orm.insert(records).values({ id: 1, value: 'duplicate' }).run() },
    ])).rejects.toThrow()

    expect(database.drizzle.select().from(records).all()).toEqual([])
  })

  it('makes close idempotent and rejects operations after closing', async () => {
    const database = createDatabase()

    await database.close()
    await expect(database.close()).resolves.toBeUndefined()
    await expect(database.executeInfrastructureSql('SELECT 1')).rejects.toThrow('The SQLite database is closed')
    await expect(database.batch([])).rejects.toThrow('The SQLite database is closed')
    expect(() => database.migrate()).toThrow('The SQLite database is closed')
  })

  it('only applies migrations once per database instance', () => {
    const database = createDatabase()

    expect(() => database.migrate()).not.toThrow()
    expect(() => database.migrate()).not.toThrow()
  })
})
