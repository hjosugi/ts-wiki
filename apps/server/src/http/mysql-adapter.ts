/**
 * MySQL implementation of the {@link DatabaseAdapter} seam.
 *
 * Kept in its own module so only the entry point's MySQL branch pulls the MySQL
 * composition roots into the graph. Like Postgres, MySQL cannot back the SQLite
 * `RateLimitDatabase` (a synchronous prepared-statement handle), so it opts into
 * in-memory rate limiting by exposing `rateLimitDatabase: null`.
 */
import type { MysqlClient } from '../db/mysql/client.ts'
import { createMysqlServices } from '../db/mysql/services.ts'
import { createMysqlDbEventBus } from '../db/mysql/event-bus.ts'
import { createMysqlAuditLogRepository } from '../db/mysql/repositories/audit-log.ts'
import { createMysqlRealtimeTicketRepository } from '../db/mysql/repositories/realtime-tickets.ts'
import { createMysqlElasticsearchDataSource } from '../db/mysql/repositories/elasticsearch.ts'
import { createEventBus } from '../realtime/bus.ts'
import type { DatabaseAdapter } from './database-adapter.ts'

/** MySQL adapter, built from a connected {@link MysqlClient}. */
export const createMysqlDatabaseAdapter = (client: MysqlClient): DatabaseAdapter => ({
  driver: 'mysql',
  createServices: (options) => createMysqlServices(client, options),
  createRealtimeBus: (realtime) =>
    realtime.eventBus === 'db'
      ? createMysqlDbEventBus(client, {
          sourceId: realtime.instanceId,
          pollIntervalMs: realtime.pollIntervalMs,
        })
      : createEventBus(),
  auditLogRepo: createMysqlAuditLogRepository(client.db),
  realtimeTicketRepo: createMysqlRealtimeTicketRepository(client.db),
  elasticsearch: createMysqlElasticsearchDataSource(client.db),
  rateLimitDatabase: null,
  close: () => client.close(),
})
