/**
 * PostgreSQL migrations.
 *
 * The DDL is generated from the pg-core declarations in `./schema.ts` — a
 * single source of truth, mirroring how the SQLite side keeps `schema.ts` and
 * its migration in lockstep. Every statement is idempotent (`IF NOT EXISTS`),
 * so `runPostgresMigrations` is safe to run on every boot, and
 * `verifyPostgresSchema` fails loudly if the live database drifts from the
 * declarations.
 *
 * Full-text search (Postgres tsvector, replacing SQLite FTS5) is deferred to a
 * later search slice; this creates the relational core only.
 */
import type { SQL } from 'bun'
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core'
import * as schema from './schema.ts'

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`

const renderDefault = (value: unknown): string => {
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  throw new Error(`Unsupported column default: ${JSON.stringify(value)}`)
}

const columnDefinition = (column: PgColumn): string => {
  const parts = [quoteIdent(column.name), column.getSQLType()]
  // A serial type carries its own default sequence (hasDefault, default undefined).
  if (column.default !== undefined) parts.push(`DEFAULT ${renderDefault(column.default)}`)
  if (column.notNull && !column.primary) parts.push('NOT NULL')
  if (column.primary) parts.push('PRIMARY KEY')
  if (column.isUnique) parts.push('UNIQUE')
  return parts.join(' ')
}

const tables = (): Array<ReturnType<typeof getTableConfig>> => {
  const configs: Array<ReturnType<typeof getTableConfig>> = []
  for (const candidate of Object.values(schema)) {
    try {
      const config = getTableConfig(candidate as PgTable)
      if (config.name && config.columns.length) configs.push(config)
    } catch {
      /* not a table export */
    }
  }
  return configs
}

/** All table names declared in the pg-core schema. */
export const postgresTableNames = (): string[] => tables().map((config) => config.name)

/** Ordered, idempotent DDL statements that materialize the schema. */
export const postgresSchemaStatements = (): string[] => {
  const statements: string[] = []
  for (const config of tables()) {
    const lines = config.columns.map(columnDefinition)
    for (const pk of config.primaryKeys) {
      lines.push(`PRIMARY KEY (${pk.columns.map((column) => quoteIdent(column.name)).join(', ')})`)
    }
    statements.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent(config.name)} (\n  ${lines.join(',\n  ')}\n)`)
    for (const index of config.indexes) {
      const name = index.config.name
      const columns = index.config.columns
        .map((column) => ('name' in column ? (column as { name: string }).name : undefined))
        .filter((columnName): columnName is string => Boolean(columnName))
      if (!name || columns.length !== index.config.columns.length) continue
      statements.push(
        `CREATE INDEX IF NOT EXISTS ${quoteIdent(name)} ON ${quoteIdent(config.name)} (${columns.map(quoteIdent).join(', ')})`,
      )
    }
  }
  return statements
}

/**
 * Full-text search backing table (the Postgres analogue of SQLite's `pages_fts`
 * FTS5 virtual table). Not expressible in pg-core — it carries a weighted
 * `tsvector` (word matching, GIN-indexed) and a lowercased `searchable` column
 * for CJK/substring `LIKE` matching — so it is raw DDL. `tsvector` GIN is
 * built-in (no extension); the `searchable` scan is unindexed, which is fine at
 * this scale (a `pg_trgm` GIN index is a later performance optimization).
 */
export const postgresSearchStatements = (): string[] => [
  `CREATE TABLE IF NOT EXISTS "page_search" (
  "page_id" text PRIMARY KEY,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "content" text NOT NULL,
  "comments" text NOT NULL,
  "assets" text NOT NULL,
  "tsv" tsvector NOT NULL,
  "searchable" text NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS "page_search_tsv_idx" ON "page_search" USING gin ("tsv")',
]

/** Create the relational schema + search table on a Postgres database. Idempotent. */
export const runPostgresMigrations = async (sql: SQL): Promise<void> => {
  const statements = [...postgresSchemaStatements(), ...postgresSearchStatements()]
  await sql.begin(async (tx: SQL) => {
    for (const statement of statements) {
      await tx.unsafe(statement)
    }
  })
}

/** Fail loudly if the live database is missing any declared column or index. */
export const verifyPostgresSchema = async (sql: SQL): Promise<void> => {
  for (const config of tables()) {
    const columnRows = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${config.name}
    `) as Array<{ column_name: string }>
    const existingColumns = new Set(columnRows.map((row) => row.column_name.toLowerCase()))
    const missingColumns = config.columns.map((column) => column.name).filter((name) => !existingColumns.has(name.toLowerCase()))
    if (missingColumns.length) {
      throw new Error(`Postgres schema drift: ${config.name} is missing columns ${missingColumns.join(', ')}`)
    }

    const indexRows = (await sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${config.name}
    `) as Array<{ indexname: string }>
    const existingIndexes = new Set(indexRows.map((row) => row.indexname))
    const missingIndexes = config.indexes
      .map((index) => index.config.name)
      .filter((name): name is string => typeof name === 'string' && !existingIndexes.has(name))
    if (missingIndexes.length) {
      throw new Error(`Postgres index drift: ${config.name} is missing indexes ${missingIndexes.join(', ')}`)
    }
  }
}
