/**
 * MySQL/MariaDB connection factory — the driver foundation for #365.
 *
 * Establishes the mysql2 pooled connection (with TLS options) and the Drizzle
 * seam that the MySQL repository implementations will be built on in later
 * slices. It is intentionally NOT wired into `createDb`/the service layer yet:
 * MySQL must not be offered as a working runtime driver until its full contract
 * suite passes (#368, "no placeholder choices"). Today it is exercised only by
 * its own integration test against a real MySQL server.
 */
import { createPool, type Pool, type PoolOptions } from 'mysql2/promise'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import type { MysqlDatabaseConfig } from '../config.ts'

/** Drizzle (mysql dialect) handle. The schema is bound in the schema slice. */
export type MysqlDb = MySql2Database<Record<string, never>>

export interface MysqlClient {
  /** Raw mysql2 pool — for hand-written SQL and lifecycle control. */
  readonly pool: Pool
  /** Drizzle (mysql dialect) handle the repository impls query through. */
  readonly db: MysqlDb
  /** Fail-fast connectivity check; rejects if the server is unreachable. */
  ping(): Promise<void>
  /** Drain and close the pool. */
  close(): Promise<void>
}

/** Map our TLS config onto mysql2's `ssl` option. */
const tlsOption = (ssl: MysqlDatabaseConfig['ssl']): PoolOptions['ssl'] => {
  // 'require' enforces TLS but does not verify the server certificate chain —
  // common with managed providers that terminate TLS with their own CA.
  if (ssl === 'require') return { rejectUnauthorized: false }
  if (ssl === true) return { rejectUnauthorized: true }
  return undefined
}

export const createMysqlClient = (config: MysqlDatabaseConfig): MysqlClient => {
  const pool = createPool({
    uri: config.url,
    ...(config.maxConnections ? { connectionLimit: config.maxConnections } : {}),
    ...(tlsOption(config.ssl) ? { ssl: tlsOption(config.ssl) } : {}),
  })
  const db = drizzle(pool)
  return {
    pool,
    db,
    async ping() {
      const connection = await pool.getConnection()
      try {
        await connection.ping()
      } finally {
        connection.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}
