/**
 * Per-dialect table-name probes for the cross-driver migration. Each returns the
 * SQL table name for a drizzle table export, or null for a non-table export
 * (enum tuples, helpers) so callers can enumerate `Object.values(schema)`.
 */
import { getTableConfig as getSqliteConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { getTableConfig as getPgConfig, type PgTable } from 'drizzle-orm/pg-core'
import { getTableConfig as getMysqlConfig, type MySqlTable } from 'drizzle-orm/mysql-core'

const nameOrNull = (read: () => { name: string; columns: readonly unknown[] }): string | null => {
  try {
    const config = read()
    return config.name && config.columns.length ? config.name : null
  } catch {
    return null
  }
}

export const getSqliteTableName = (table: unknown): string | null => nameOrNull(() => getSqliteConfig(table as SQLiteTable))
export const getPgTableName = (table: unknown): string | null => nameOrNull(() => getPgConfig(table as PgTable))
export const getMysqlTableName = (table: unknown): string | null => nameOrNull(() => getMysqlConfig(table as MySqlTable))
