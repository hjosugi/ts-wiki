export type DatabaseDriver = 'sqlite' | 'libsql'

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

export type DatabaseConfig = SqliteDatabaseConfig | LibsqlDatabaseConfig

export const DEFAULT_SQLITE_PATH = './data/ts-wiki.sqlite'
export const DEFAULT_LIBSQL_REPLICA_FILENAME = 'ts-wiki-libsql-replica.db'

export class UnsupportedDatabaseDriverError extends Error {
  constructor(config: DatabaseConfig, surface = 'server runtime') {
    super(`${surface} does not support DATABASE_DRIVER=${config.driver}.`)
    this.name = 'UnsupportedDatabaseDriverError'
  }
}
