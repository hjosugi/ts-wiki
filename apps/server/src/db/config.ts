export type DatabaseDriver = 'sqlite' | 'libsql' | 'postgres' | 'mysql'

export interface SqliteDatabaseConfig {
  readonly driver: 'sqlite'
  readonly path: string
}

export interface LibsqlDatabaseConfig {
  readonly driver: 'libsql'
  /** Remote Turso/libSQL URL or a local libSQL file URL such as file:/data/wiki.db. */
  readonly url: string
  readonly authToken: string | null
  /**
   * Local embedded-replica file. When `url` is remote, this is the database the
   * synchronous service layer opens while libSQL syncs it with Turso.
   */
  readonly replicaPath: string | null
}

export interface PostgresDatabaseConfig {
  readonly driver: 'postgres'
  /** libpq-style connection string, e.g. postgres://user:pass@host:5432/db. */
  readonly url: string
  /**
   * TLS for the connection. `false` disables it (local/test), `true` enables it
   * with the platform trust store, `'require'` enforces it without verifying the
   * server certificate chain (managed providers that terminate TLS internally).
   */
  readonly ssl: boolean | 'require'
  /** Upper bound on pooled connections. Null defers to the driver default. */
  readonly maxConnections: number | null
}

export interface MysqlDatabaseConfig {
  readonly driver: 'mysql'
  /** Connection string, e.g. mysql://user:pass@host:3306/db. Covers MySQL and MariaDB. */
  readonly url: string
  /**
   * TLS for the connection. `false` disables it (local/test), `true` enables it
   * verifying the server certificate, `'require'` enforces TLS without verifying
   * the chain (managed providers that terminate TLS with their own CA).
   */
  readonly ssl: boolean | 'require'
  /** Upper bound on pooled connections. Null defers to the driver default. */
  readonly maxConnections: number | null
}

export type DatabaseConfig =
  | SqliteDatabaseConfig
  | LibsqlDatabaseConfig
  | PostgresDatabaseConfig
  | MysqlDatabaseConfig

export const DEFAULT_SQLITE_PATH = './data/ts-wiki.sqlite'
export const DEFAULT_LIBSQL_REPLICA_FILENAME = 'ts-wiki-libsql-replica.db'

export class UnsupportedDatabaseDriverError extends Error {
  constructor(config: DatabaseConfig, surface = 'server runtime') {
    super(`${surface} does not support DATABASE_DRIVER=${config.driver}.`)
    this.name = 'UnsupportedDatabaseDriverError'
  }
}
