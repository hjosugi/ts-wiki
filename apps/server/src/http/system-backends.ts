/**
 * Read-only description of the active storage & search backends, for the Admin
 * "Storage & search" screen (#367). This lives at the HTTP/composition layer,
 * not in the driver-neutral service layer, because the active driver is infra
 * knowledge the services deliberately do not hold.
 */
import type { DatabaseDriver } from '../db/config.ts'
import type { AssetStorageType } from '../storage/assets.ts'

/** The full-text engine each database driver uses for the built-in search. */
export type SearchEngine = 'fts5' | 'tsvector' | 'fulltext'

export interface SystemBackendsStatus {
  readonly database: { readonly driver: DatabaseDriver; readonly healthy: boolean }
  readonly search: { readonly backend: 'builtin'; readonly engine: SearchEngine; readonly healthy: boolean }
  readonly assets: { readonly backend: AssetStorageType; readonly healthy: boolean }
}

/**
 * Which full-text engine backs the built-in search for a given driver. SQLite
 * and libSQL use FTS5; Postgres uses tsvector; MySQL uses a FULLTEXT index.
 */
export const searchEngineForDriver = (driver: DatabaseDriver): SearchEngine =>
  driver === 'postgres' ? 'tsvector' : driver === 'mysql' ? 'fulltext' : 'fts5'

export const describeSystemBackends = (input: {
  readonly databaseDriver: DatabaseDriver
  readonly assetBackend: AssetStorageType
  readonly databaseHealthy: boolean
}): SystemBackendsStatus => ({
  database: { driver: input.databaseDriver, healthy: input.databaseHealthy },
  // Full-text search is currently provided by the database driver itself, so
  // its health tracks the database's — the index lives there. An external
  // search backend (Elasticsearch, #366) will add a second `backend` value.
  search: {
    backend: 'builtin',
    engine: searchEngineForDriver(input.databaseDriver),
    healthy: input.databaseHealthy,
  },
  // Local storage is always available; R2 is not actively probed yet, so its
  // presence in config is reported as healthy until a live probe is added.
  assets: { backend: input.assetBackend, healthy: true },
})
