/**
 * Cross-driver data migration: copy every row from the SQLite database into a
 * fresh Postgres or MySQL target, then rebuild the target's search index.
 *
 * The three schemas mirror each other table-for-table with matching JS column
 * types and no foreign keys, so rows read from SQLite insert directly into the
 * target and insert order is free. Search tables are derived (the FTS5 virtual
 * table / `page_search`), never copied — the target index is rebuilt from the
 * migrated pages instead. Postgres serial sequences are advanced past the copied
 * ids so later inserts don't collide.
 *
 *   DATABASE_DRIVER=postgres DATABASE_URL=... bun run db:migrate-to --to postgres [--from sqlite.db] [--dry-run]
 */
import { join } from 'node:path'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { MySqlTable } from 'drizzle-orm/mysql-core'
import { getMysqlTableName, getPgTableName, getSqliteTableName } from './cross-driver-tables.ts'
import { loadEnv, type Env } from '../env.ts'
import { createDb, type DB } from './client.ts'
import { createPostgresClient, type PostgresClient } from './postgres/client.ts'
import { runPostgresMigrations } from './postgres/migrate.ts'
import { createPostgresSearchIndexer } from './postgres/repositories/search.ts'
import { createMysqlClient, type MysqlClient } from './mysql/client.ts'
import { runMysqlMigrations } from './mysql/migrate.ts'
import { createMysqlSearchIndexer } from './mysql/repositories/search.ts'
import type { SearchTokenizer } from '../services/search.ts'
import * as sqliteSchema from './schema.ts'
import * as pgSchema from './postgres/schema.ts'
import * as mysqlSchema from './mysql/schema.ts'

const INSERT_CHUNK = 500

// Tables whose `id` is an auto-increment/serial in the server drivers; their
// Postgres sequences must be advanced past the copied ids after a migration.
const SERIAL_ID_TABLES = ['wiki_events', 'audit_log'] as const

export type TargetDriver = 'postgres' | 'mysql'
export type MigrationMode = 'apply' | 'dry-run'

export interface TableMigration {
  readonly table: string
  readonly rows: number
  readonly skipped?: boolean
}
export interface MigrationReport {
  readonly mode: MigrationMode
  readonly target: TargetDriver
  readonly tables: TableMigration[]
  readonly totalRows: number
}

/** A migration target abstracts the concrete Postgres/MySQL drizzle types. */
export interface CrossDriverTarget {
  readonly driver: TargetDriver
  hasTable(name: string): boolean
  insert(name: string, rows: Record<string, unknown>[]): Promise<void>
  isEmpty(): Promise<boolean>
  finalize(): Promise<void>
}

interface NamedTable<T> {
  readonly name: string
  readonly table: T
}

const enumerateTables = <T>(schema: Record<string, unknown>, nameOf: (table: T) => string | null): NamedTable<T>[] => {
  const out: NamedTable<T>[] = []
  for (const candidate of Object.values(schema)) {
    const name = nameOf(candidate as T)
    if (name) out.push({ name, table: candidate as T })
  }
  return out
}

const sourceTables = (): NamedTable<SQLiteTable>[] =>
  enumerateTables<SQLiteTable>(sqliteSchema, getSqliteTableName)

/** Postgres migration target. Reindexes and advances serial sequences on finalize. */
export const createPostgresMigrationTarget = (client: PostgresClient, tokenizer: SearchTokenizer): CrossDriverTarget => {
  const tables = new Map(enumerateTables<PgTable>(pgSchema, getPgTableName).map((entry) => [entry.name, entry.table]))
  return {
    driver: 'postgres',
    hasTable: (name) => tables.has(name),
    async insert(name, rows) {
      const table = tables.get(name)
      if (table) await client.db.insert(table).values(rows as never)
    },
    async isEmpty() {
      const rows = await client.db.select({ id: pgSchema.users.id }).from(pgSchema.users).limit(1)
      return rows.length === 0
    },
    async finalize() {
      for (const name of SERIAL_ID_TABLES) {
        await client.sql.unsafe(
          `SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM "${name}"), 1))`,
        )
      }
      await createPostgresSearchIndexer(client, { configuredTokenizer: tokenizer }).rebuild(tokenizer)
    },
  }
}

/** MySQL migration target. Auto-increment counters advance on explicit inserts, so only search is rebuilt. */
export const createMysqlMigrationTarget = (client: MysqlClient, tokenizer: SearchTokenizer): CrossDriverTarget => {
  const tables = new Map(enumerateTables<MySqlTable>(mysqlSchema, getMysqlTableName).map((entry) => [entry.name, entry.table]))
  return {
    driver: 'mysql',
    hasTable: (name) => tables.has(name),
    async insert(name, rows) {
      const table = tables.get(name)
      if (table) await client.db.insert(table).values(rows as never)
    },
    async isEmpty() {
      const rows = await client.db.select({ id: mysqlSchema.users.id }).from(mysqlSchema.users).limit(1)
      return rows.length === 0
    },
    async finalize() {
      await createMysqlSearchIndexer(client, { configuredTokenizer: tokenizer }).rebuild(tokenizer)
    },
  }
}

/**
 * Copy every source table into the target. In dry-run mode nothing is written —
 * rows are only counted. Refuses to write into a non-empty target.
 */
export const migrateToDriver = async (
  source: DB,
  target: CrossDriverTarget,
  options: { mode: MigrationMode } = { mode: 'apply' },
): Promise<MigrationReport> => {
  if (options.mode === 'apply' && !(await target.isEmpty())) {
    throw new Error('Target database is not empty. Migrate into a freshly created database.')
  }
  const tables: TableMigration[] = []
  for (const { name, table } of sourceTables()) {
    if (!target.hasTable(name)) {
      tables.push({ table: name, rows: 0, skipped: true })
      continue
    }
    const rows = source.select().from(table).all() as Record<string, unknown>[]
    if (options.mode === 'apply') {
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await target.insert(name, rows.slice(i, i + INSERT_CHUNK))
      }
    }
    tables.push({ table: name, rows: rows.length })
  }
  if (options.mode === 'apply') await target.finalize()
  return {
    mode: options.mode,
    target: target.driver,
    tables,
    totalRows: tables.reduce((sum, entry) => sum + entry.rows, 0),
  }
}

const argvValue = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

const defaultSourcePath = (env: Env): string => join(env.dataDir, 'ts-wiki.sqlite')

const printReport = (report: MigrationReport): void => {
  console.log(`\n${report.mode === 'dry-run' ? '[dry-run] ' : ''}sqlite → ${report.target}`)
  for (const table of report.tables) {
    if (table.skipped) console.log(`  · skip   ${table.table} (no target table)`)
    else console.log(`  ${report.mode === 'dry-run' ? '·' : '✓'} ${String(table.rows).padStart(6)}  ${table.table}`)
  }
  console.log(`  ${report.mode === 'dry-run' ? 'would migrate' : 'migrated'} ${report.totalRows} rows across ${report.tables.filter((t) => !t.skipped).length} tables\n`)
}

/** CLI entry: opens the SQLite source and the env-configured Postgres/MySQL target. */
export const runCrossDriverMigration = async (argv: string[] = process.argv.slice(2)): Promise<void> => {
  const to = argvValue(argv, '--to')
  const mode: MigrationMode = argv.includes('--dry-run') ? 'dry-run' : 'apply'
  if (to !== 'postgres' && to !== 'mysql') {
    throw new Error('Usage: db:migrate-to --to <postgres|mysql> [--from <sqlite path>] [--dry-run]')
  }
  const env = loadEnv()
  if (env.database.driver !== to) {
    throw new Error(`Set DATABASE_DRIVER=${to} and DATABASE_URL to the target database (got driver=${env.database.driver}).`)
  }
  const tokenizer: SearchTokenizer = env.search.ftsTokenizer
  const source = createDb(argvValue(argv, '--from') ?? defaultSourcePath(env), { ftsTokenizer: env.search.ftsTokenizer })
  try {
    if (env.database.driver === 'postgres') {
      const client = createPostgresClient(env.database)
      try {
        await client.ping()
        await runPostgresMigrations(client.sql)
        printReport(await migrateToDriver(source, createPostgresMigrationTarget(client, tokenizer), { mode }))
      } finally {
        await client.close()
      }
    } else if (env.database.driver === 'mysql') {
      const client = createMysqlClient(env.database)
      try {
        await client.ping()
        await runMysqlMigrations(client.pool)
        printReport(await migrateToDriver(source, createMysqlMigrationTarget(client, tokenizer), { mode }))
      } finally {
        await client.close()
      }
    }
  } finally {
    source.$client.close()
  }
}

if (import.meta.main) {
  await runCrossDriverMigration()
}
