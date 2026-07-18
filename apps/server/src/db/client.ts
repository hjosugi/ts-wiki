/**
 * Database client factory. Returns a Drizzle instance (typed queries) with a
 * raw SQLite-compatible handle attached for the few hand-written FTS5 queries.
 *
 * A factory — not a module-level singleton — so tests can spin up an in-memory
 * database and inject it. This is the dependency-injection seam the whole app
 * is built around (contrast Wiki.js's global `WIKI.db`).
 */
import { Database as BunDatabase } from 'bun:sqlite'
import LibsqlDatabase from 'libsql'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect'
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session'
import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm/relations'
import { UnsupportedDatabaseDriverError } from './config.ts'
import type { DatabaseConfig, DatabaseDriver, LibsqlDatabaseConfig } from './config.ts'
import * as schema from './schema.ts'
import { runMigrationsAtomically, verifyDatabaseSchema, type FtsTokenizer } from './migrate.ts'

export interface RawStatement {
  run(...params: unknown[]): { readonly changes?: number; readonly lastInsertRowid?: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  raw?(enabled?: boolean): RawStatement
}

export interface RawDatabase {
  prepare(sql: string): RawStatement
  exec(sql: string): unknown
  close(): unknown
  sync?(): unknown
}

export type DB = BunSQLiteDatabase<typeof schema> & {
  readonly $client: RawDatabase
  readonly $driver: DatabaseDriver
  readonly $syncAfterWrite?: () => Promise<void>
}

export interface CreateDbOptions {
  /** Run migrations on open. Default true. */
  readonly migrate?: boolean
  /** FTS5 tokenizer used when creating pages_fts. Default unicode61. */
  readonly ftsTokenizer?: FtsTokenizer
}

export const createSqliteDb = (path: string, options: CreateDbOptions = {}): DB => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new BunDatabase(path, { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  sqlite.exec('PRAGMA busy_timeout = 5000;')
  if (options.migrate !== false) runMigrationsAtomically(sqlite, { ftsTokenizer: options.ftsTokenizer })
  const db = drizzle(sqlite, { schema })
  // Drizzle exposes Bun's concrete Database type while the application keeps a
  // deliberately smaller cross-driver raw client surface.
  return Object.assign(db, { $client: sqlite, $driver: 'sqlite' as const }) as unknown as DB
}

const sqliteConfig = (path: string): DatabaseConfig => ({ driver: 'sqlite', path })

const isRemoteLibsqlUrl = (url: string): boolean => /^(libsql|https?|wss?):/i.test(url)

const isMemoryPath = (path: string): boolean => path === ':memory:' || path === 'file::memory:'

const mkdirForDatabasePath = (path: string): void => {
  if (isMemoryPath(path)) return
  if (path.startsWith('file:')) {
    try {
      mkdirSync(dirname(fileURLToPath(path)), { recursive: true })
      return
    } catch {
      // Relative file: paths are accepted by libSQL but not by fileURLToPath().
      mkdirSync(dirname(path.slice('file:'.length)), { recursive: true })
      return
    }
  }
  mkdirSync(dirname(path), { recursive: true })
}

const libsqlOpenTarget = (config: LibsqlDatabaseConfig): { path: string; syncUrl?: string } => {
  if (isRemoteLibsqlUrl(config.url)) {
    if (!config.replicaPath) {
      throw new Error('DATABASE_DRIVER=libsql with a remote LIBSQL_URL requires LIBSQL_REPLICA_PATH.')
    }
    return { path: config.replicaPath, syncUrl: config.url }
  }
  return { path: config.url }
}

class LibsqlSyncDrizzleDatabase extends BaseSQLiteDatabase<'sync', unknown, typeof schema> {}

const drizzleLibsqlSync = (client: RawDatabase): DB => {
  const tablesConfig = extractTablesRelationalConfig(schema, createTableRelationsHelpers)
  const relationalSchema = {
    fullSchema: schema,
    schema: tablesConfig.tables,
    tableNamesMap: tablesConfig.tableNamesMap,
  }
  const dialect = new SQLiteSyncDialect()
  type SessionArgs = ConstructorParameters<typeof BetterSQLiteSession>
  const session = new BetterSQLiteSession(
    client as unknown as SessionArgs[0],
    dialect,
    relationalSchema as unknown as SessionArgs[2],
  )
  type DatabaseArgs = ConstructorParameters<typeof LibsqlSyncDrizzleDatabase>
  const db = new LibsqlSyncDrizzleDatabase(
    'sync',
    dialect,
    session as unknown as DatabaseArgs[2],
    relationalSchema as unknown as DatabaseArgs[3],
  )
  return Object.assign(db, { $client: client, $driver: 'libsql' as const }) as unknown as DB
}

export const createLibsqlDb = (config: LibsqlDatabaseConfig, options: CreateDbOptions = {}): DB => {
  const target = libsqlOpenTarget(config)
  mkdirForDatabasePath(target.path)
  const client = new LibsqlDatabase(target.path, {
    ...(target.syncUrl ? { syncUrl: target.syncUrl } : {}),
    ...(config.authToken ? { authToken: config.authToken } : {}),
  } as ConstructorParameters<typeof LibsqlDatabase>[1]) as RawDatabase

  // Pull an existing primary before inspecting or migrating the local replica.
  if (target.syncUrl) client.sync?.()
  client.exec('PRAGMA foreign_keys = ON;')
  // Remote embedded replicas reject busy_timeout because writer lock timing is
  // owned by the primary server, not the local replica connection.
  if (!target.syncUrl) client.exec('PRAGMA busy_timeout = 5000;')
  if (options.migrate !== false) {
    runMigrationsAtomically(client, {
      ftsTokenizer: options.ftsTokenizer,
      verifySchema: !target.syncUrl,
    })
  }
  if (target.syncUrl) {
    client.sync?.()
    if (options.migrate !== false) verifyDatabaseSchema(client)
  }

  const db = drizzleLibsqlSync(client)
  return target.syncUrl
    ? Object.assign(db, {
        $syncAfterWrite: async () => {
          client.sync?.()
          // libSQL primary writes become visible to an embedded replica on a
          // short read-your-writes delay even when sync() reports no new frame.
          await new Promise((resolve) => setTimeout(resolve, 250))
          client.sync?.()
        },
      })
    : db
}

export const createDb = (configOrPath: DatabaseConfig | string, options: CreateDbOptions = {}): DB => {
  const config = typeof configOrPath === 'string' ? sqliteConfig(configOrPath) : configOrPath
  if (config.driver === 'libsql') {
    return createLibsqlDb(config, options)
  }
  if (config.driver === 'postgres') {
    // `createDb` only builds the SQLite-family (bun:sqlite / libSQL) handle.
    // Postgres runs through `createPostgresClient` + `createPostgresDatabaseAdapter`
    // in the entry point instead, so reaching here means a SQLite-only caller was
    // handed a Postgres config — fail fast rather than fall back silently.
    throw new UnsupportedDatabaseDriverError(config, 'server runtime')
  }
  return createSqliteDb(config.path, options)
}
