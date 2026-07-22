/**
 * Driver-neutral database seam consumed by `createApp`.
 *
 * Each backing driver supplies an adapter that builds its composition roots
 * (the service layer, the realtime bus) on demand and exposes its repositories,
 * so the HTTP layer never imports a concrete driver. `createApp` receives an
 * adapter instead of a `DB`, and the entry point picks the adapter for the
 * configured driver.
 */
import type { DatabaseDriver } from '../db/config.ts'
import type { DB } from '../db/client.ts'
import { createServices } from '../db/services.ts'
import { createSqliteAuditLogRepository } from '../db/repositories/audit-log.ts'
import { createSqliteRealtimeTicketRepository } from '../db/repositories/realtime-tickets.ts'
import type { Services, ServiceOptions } from '../services/index.ts'
import { createRealtimeBus } from '../realtime/runtime.ts'
import type { EventBus } from '../realtime/bus.ts'
import type { RealtimeEnv } from '../env.ts'
import type { AuditLogRepository } from '../repositories/audit-log.ts'
import type { RealtimeTicketRepository } from '../repositories/realtime-tickets.ts'
import type { RateLimitDatabase } from './rate-limit.ts'
import type { ElasticsearchSearchDataSource } from '../search/elasticsearch/search.ts'
import { createSqliteElasticsearchDataSource } from '../db/repositories/elasticsearch.ts'

export interface DatabaseAdapter {
  readonly driver: DatabaseDriver
  /** Compose the driver-neutral service layer with app-supplied options. */
  createServices(options: ServiceOptions): Services
  /** Build the realtime event bus (DB-backed or in-memory per `realtime.eventBus`). */
  createRealtimeBus(realtime: RealtimeEnv): EventBus
  readonly auditLogRepo: AuditLogRepository
  readonly realtimeTicketRepo: RealtimeTicketRepository
  /** Driver-specific page/outbox access used only by the optional ES runtime. */
  readonly elasticsearch: ElasticsearchSearchDataSource
  /**
   * Raw handle backing shared DB rate limiting, or null when the driver cannot
   * provide a synchronous `RateLimitDatabase` (Postgres → in-memory limiters).
   */
  readonly rateLimitDatabase: RateLimitDatabase | null
  /** Release the underlying connection(s). Owned by the entry point, not `createApp`. */
  close(): void | Promise<void>
}

/** SQLite/libSQL adapter, built from an open {@link DB} handle. */
export const createSqliteDatabaseAdapter = (db: DB): DatabaseAdapter => ({
  driver: db.$driver,
  createServices: (options) => createServices(db, options),
  createRealtimeBus: (realtime) => createRealtimeBus(db, realtime),
  auditLogRepo: createSqliteAuditLogRepository(db),
  realtimeTicketRepo: createSqliteRealtimeTicketRepository(db),
  elasticsearch: createSqliteElasticsearchDataSource(db),
  rateLimitDatabase: db.$client,
  close: () => { db.$client.close() },
})
