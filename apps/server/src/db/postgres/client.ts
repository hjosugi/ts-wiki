/**
 * PostgreSQL connection factory — the driver foundation for #364.
 *
 * This establishes the Bun.SQL-backed pooled connection (with TLS options) and
 * the Drizzle seam that the PostgreSQL repository implementations will be built
 * on in later slices. It is intentionally NOT wired into `createDb`/the service
 * layer yet: PostgreSQL must not be offered as a working runtime driver until
 * its full contract suite passes (#368, "no placeholder choices"). Today it is
 * exercised only by its own integration test against a real Postgres server.
 */
import { SQL } from 'bun'
import { drizzle, type BunSQLDatabase } from 'drizzle-orm/bun-sql'
import type { PostgresDatabaseConfig } from '../config.ts'
import * as schema from './schema.ts'

/** Drizzle (pg dialect) handle bound to the PostgreSQL schema. */
export type PostgresDb = BunSQLDatabase<typeof schema>

export interface PostgresClient {
  /** Raw Bun.SQL pool — for hand-written SQL and lifecycle control. */
  readonly sql: SQL
  /** Drizzle (pg dialect) handle the repository impls query through. */
  readonly db: PostgresDb
  /** Fail-fast connectivity check; rejects if the server is unreachable. */
  ping(): Promise<void>
  /** Drain and close the pool. */
  close(): Promise<void>
}

/** Map our TLS config onto Bun.SQL's `tls` option. */
const tlsOption = (ssl: PostgresDatabaseConfig['ssl']): boolean | { rejectUnauthorized: boolean } => {
  // 'require' enforces TLS but does not verify the server certificate chain —
  // common with managed providers that terminate TLS with their own CA.
  if (ssl === 'require') return { rejectUnauthorized: false }
  return ssl
}

export const createPostgresClient = (config: PostgresDatabaseConfig): PostgresClient => {
  const sql = new SQL({
    url: config.url,
    tls: tlsOption(config.ssl),
    ...(config.maxConnections ? { max: config.maxConnections } : {}),
  })
  const db = drizzle(sql, { schema })
  return {
    sql,
    db,
    async ping() {
      await sql`select 1`
    },
    async close() {
      await sql.end()
    },
  }
}
