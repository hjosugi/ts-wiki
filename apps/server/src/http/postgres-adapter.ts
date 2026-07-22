/**
 * PostgreSQL implementation of the {@link DatabaseAdapter} seam.
 *
 * Kept in its own module so only the entry point's Postgres branch pulls the
 * Postgres composition roots into the graph. Postgres cannot back the SQLite
 * `RateLimitDatabase` (a synchronous prepared-statement handle), so it opts into
 * in-memory rate limiting by exposing `rateLimitDatabase: null`.
 */
import type { PostgresClient } from '../db/postgres/client.ts'
import { createPostgresServices } from '../db/postgres/services.ts'
import { createPostgresDbEventBus } from '../db/postgres/event-bus.ts'
import { createPostgresAuditLogRepository } from '../db/postgres/repositories/audit-log.ts'
import { createPostgresRealtimeTicketRepository } from '../db/postgres/repositories/realtime-tickets.ts'
import { createPostgresElasticsearchDataSource } from '../db/postgres/repositories/elasticsearch.ts'
import { createEventBus } from '../realtime/bus.ts'
import type { DatabaseAdapter } from './database-adapter.ts'

/** PostgreSQL adapter, built from a connected {@link PostgresClient}. */
export const createPostgresDatabaseAdapter = (client: PostgresClient): DatabaseAdapter => ({
  driver: 'postgres',
  createServices: (options) => createPostgresServices(client, options),
  createRealtimeBus: (realtime) =>
    realtime.eventBus === 'db'
      ? createPostgresDbEventBus(client, {
          sourceId: realtime.instanceId,
          pollIntervalMs: realtime.pollIntervalMs,
        })
      : createEventBus(),
  auditLogRepo: createPostgresAuditLogRepository(client.db),
  realtimeTicketRepo: createPostgresRealtimeTicketRepository(client.db),
  elasticsearch: createPostgresElasticsearchDataSource(client.db),
  rateLimitDatabase: null,
  close: () => client.close(),
})
