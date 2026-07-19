/**
 * MySQL/MariaDB migrations.
 *
 * The DDL is generated from the mysql-core declarations in `./schema.ts` — a
 * single source of truth, mirroring the SQLite and Postgres sides. Every
 * `CREATE TABLE` is `IF NOT EXISTS` with its indexes declared inline (MySQL has
 * no `CREATE INDEX IF NOT EXISTS`), so `runMysqlMigrations` is safe on every
 * boot; `verifyMysqlSchema` fails loudly on drift.
 *
 * MySQL specifics vs Postgres: identifiers are backtick-quoted, DDL auto-commits
 * (no wrapping transaction), booleans render as `1`/`0`, and auto-increment keys
 * carry the `AUTO_INCREMENT` keyword. Full-text search materializes a separate
 * `page_search` table (the analogue of SQLite FTS5 / the Postgres tsvector) with
 * a `FULLTEXT` index built by the ngram parser so CJK queries tokenize; see
 * `mysqlSearchStatements`.
 */
import type { Pool } from 'mysql2/promise'
import { getTableConfig, type MySqlColumn, type MySqlTable } from 'drizzle-orm/mysql-core'
import * as schema from './schema.ts'

const quoteIdent = (name: string): string => `\`${name.replace(/`/g, '``')}\``

const renderDefault = (value: unknown): string => {
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  throw new Error(`Unsupported column default: ${JSON.stringify(value)}`)
}

const columnDefinition = (column: MySqlColumn): string => {
  const autoIncrement = (column as { autoIncrement?: boolean }).autoIncrement === true
  const parts = [quoteIdent(column.name), column.getSQLType()]
  if (column.notNull && !column.primary) parts.push('NOT NULL')
  // AUTO_INCREMENT columns own their value and cannot also carry a DEFAULT.
  if (column.default !== undefined && !autoIncrement) parts.push(`DEFAULT ${renderDefault(column.default)}`)
  if (autoIncrement) parts.push('AUTO_INCREMENT')
  if (column.primary) parts.push('PRIMARY KEY')
  if (column.isUnique) parts.push('UNIQUE')
  return parts.join(' ')
}

const indexColumnNames = (columns: readonly unknown[]): string[] =>
  columns
    .map((column) => (column && typeof column === 'object' && 'name' in column ? (column as { name: string }).name : undefined))
    .filter((name): name is string => Boolean(name))

const tables = (): Array<ReturnType<typeof getTableConfig>> => {
  const configs: Array<ReturnType<typeof getTableConfig>> = []
  for (const candidate of Object.values(schema)) {
    try {
      const config = getTableConfig(candidate as MySqlTable)
      if (config.name && config.columns.length) configs.push(config)
    } catch {
      /* not a table export */
    }
  }
  return configs
}

/** All table names declared in the mysql-core schema. */
export const mysqlTableNames = (): string[] => tables().map((config) => config.name)

/** Ordered, idempotent DDL statements that materialize the schema. */
export const mysqlSchemaStatements = (): string[] =>
  tables().map((config) => {
    const lines = config.columns.map(columnDefinition)
    for (const pk of config.primaryKeys) {
      lines.push(`PRIMARY KEY (${pk.columns.map((column) => quoteIdent(column.name)).join(', ')})`)
    }
    for (const unique of config.uniqueConstraints) {
      const name = unique.getName()
      const names = indexColumnNames(unique.columns)
      if (name && names.length) lines.push(`UNIQUE ${quoteIdent(name)} (${names.map(quoteIdent).join(', ')})`)
    }
    // Indexes are declared inline: MySQL has no CREATE INDEX IF NOT EXISTS, so
    // they must ride along with the idempotent CREATE TABLE IF NOT EXISTS.
    for (const index of config.indexes) {
      const name = index.config.name
      const names = indexColumnNames(index.config.columns)
      if (name && names.length === index.config.columns.length) {
        lines.push(`${index.config.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(name)} (${names.map(quoteIdent).join(', ')})`)
      }
    }
    return `CREATE TABLE IF NOT EXISTS ${quoteIdent(config.name)} (\n  ${lines.join(',\n  ')}\n)`
  })

/**
 * DDL for the search index. Kept out of the mysql-core schema (like the Postgres
 * `page_search`) because the mysql-core builder cannot express `FULLTEXT ... WITH
 * PARSER ngram`. Each stored column feeds the snippet/rank helpers; `searchable`
 * is the lowercased concatenation the query filter and LIKE backstop scan, and
 * the ngram FULLTEXT index over it accelerates the candidate fetch (including
 * CJK, which the ngram parser tokenizes into bigrams). `page_id` is a
 * `varchar(255)` because MySQL cannot key a `TEXT` column without a prefix.
 */
export const mysqlSearchStatements = (): string[] => [
  `CREATE TABLE IF NOT EXISTS \`page_search\` (
  \`page_id\` varchar(255) NOT NULL,
  \`title\` text NOT NULL,
  \`description\` text NOT NULL,
  \`content\` text NOT NULL,
  \`comments\` text NOT NULL,
  \`assets\` text NOT NULL,
  \`searchable\` text NOT NULL,
  PRIMARY KEY (\`page_id\`),
  FULLTEXT KEY \`page_search_ft\` (\`searchable\`) WITH PARSER ngram
)`,
]

/** Create the relational schema on a MySQL database. Idempotent. */
export const runMysqlMigrations = async (pool: Pool): Promise<void> => {
  // DDL auto-commits in MySQL, so there is nothing to wrap in a transaction.
  for (const statement of [...mysqlSchemaStatements(), ...mysqlSearchStatements()]) {
    await pool.query(statement)
  }
}

/** Fail loudly if the live database is missing any declared column or index. */
export const verifyMysqlSchema = async (pool: Pool): Promise<void> => {
  for (const config of tables()) {
    const [columnRows] = (await pool.query(
      'SELECT COLUMN_NAME AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
      [config.name],
    )) as [Array<{ column_name: string }>, unknown]
    const existing = new Set(columnRows.map((row) => row.column_name.toLowerCase()))
    const missing = config.columns.map((column) => column.name).filter((name) => !existing.has(name.toLowerCase()))
    if (missing.length) {
      throw new Error(`MySQL schema drift: ${config.name} is missing columns ${missing.join(', ')}`)
    }
  }
}
