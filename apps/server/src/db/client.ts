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
import type { DatabaseConfig, DatabaseDriver, LibsqlDatabaseConfig } from './config.ts'
import * as schema from './schema.ts'
import { runMigrations } from './migrate.ts'

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
}

export interface CreateDbOptions {
  /** Run migrations on open. Default true. */
  readonly migrate?: boolean
}

export const createSqliteDb = (path: string, options: CreateDbOptions = {}): DB => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new BunDatabase(path, { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  if (options.migrate !== false) runMigrations(sqlite)
  const db = drizzle(sqlite, { schema }) as unknown as DB
  return Object.assign(db, { $client: sqlite, $driver: 'sqlite' as const })
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
  const session = new BetterSQLiteSession(client as never, dialect, relationalSchema as never)
  const db = new LibsqlSyncDrizzleDatabase('sync', dialect, session as never, relationalSchema as never)
  return Object.assign(db, { $client: client, $driver: 'libsql' as const }) as DB
}

export const createLibsqlDb = (config: LibsqlDatabaseConfig, options: CreateDbOptions = {}): DB => {
  const target = libsqlOpenTarget(config)
  mkdirForDatabasePath(target.path)
  const client = new LibsqlDatabase(target.path, {
    ...(target.syncUrl ? { syncUrl: target.syncUrl } : {}),
    ...(config.authToken ? { authToken: config.authToken } : {}),
  } as never) as RawDatabase

  client.exec('PRAGMA foreign_keys = ON;')
  if (options.migrate !== false) runMigrations(client)
  if (target.syncUrl) client.sync?.()

  return drizzleLibsqlSync(client)
}

export const createDb = (configOrPath: DatabaseConfig | string, options: CreateDbOptions = {}): DB => {
  const config = typeof configOrPath === 'string' ? sqliteConfig(configOrPath) : configOrPath
  if (config.driver === 'libsql') {
    return createLibsqlDb(config, options)
  }
  return createSqliteDb(config.path, options)
}
