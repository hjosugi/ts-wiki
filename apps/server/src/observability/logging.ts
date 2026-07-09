import { lte } from 'drizzle-orm'
import type { DB } from '../db/client.ts'
import { auditLog } from '../db/schema.ts'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEvent {
  readonly type: string
  readonly level?: LogLevel
  readonly [key: string]: unknown
}

export interface StructuredLogger {
  info(event: LogEvent): void
  warn(event: LogEvent): void
  error(event: LogEvent): void
}

const write = (level: LogLevel, event: LogEvent): void => {
  const payload = {
    ts: new Date().toISOString(),
    level,
    ...event,
  }
  console[level](JSON.stringify(payload))
}

export const consoleStructuredLogger: StructuredLogger = {
  info: (event) => write('info', event),
  warn: (event) => write('warn', event),
  error: (event) => write('error', event),
}

export interface AuditPersistenceOptions {
  readonly persist: boolean
  readonly retentionDays: number
  readonly maxRows: number
}

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
    })
  }
}

const persistAuditEvent = (
  db: DB,
  sink: StructuredLogger,
  event: LogEvent,
  options: AuditPersistenceOptions,
): void => {
  const action = typeof event.action === 'string' && event.action.trim() ? event.action.trim() : null
  if (!action) return
  const now = Date.now()
  const userId = typeof event.userId === 'string' ? event.userId : null
  const path = typeof event.path === 'string' ? event.path : null
  const { type: _type, action: _action, userId: _userId, path: _path, ...data } = event
  try {
    db.insert(auditLog).values({
      action,
      userId,
      path,
      data: safeJson(data),
      createdAt: now,
    }).run()
    db.delete(auditLog)
      .where(lte(auditLog.createdAt, now - options.retentionDays * 24 * 60 * 60 * 1000))
      .run()
    db.$client.prepare(`
      DELETE FROM audit_log
      WHERE id NOT IN (
        SELECT id FROM audit_log
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      )
    `).run(options.maxRows)
  } catch (error) {
    sink.warn({
      type: 'audit',
      action: 'audit.persist_failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export const createAuditLogger = (
  db: DB,
  sink: StructuredLogger,
  options: AuditPersistenceOptions,
): StructuredLogger => ({
  info: (event) => {
    sink.info(event)
    if (options.persist && event.type === 'audit') persistAuditEvent(db, sink, event, options)
  },
  warn: (event) => sink.warn(event),
  error: (event) => sink.error(event),
})

export const audit = (
  logger: StructuredLogger,
  action: string,
  fields: Record<string, unknown> = {},
): void => {
  logger.info({
    type: 'audit',
    action,
    ...fields,
  })
}

export const requestLog = (
  logger: StructuredLogger,
  fields: {
    method: string
    path: string
    status: number
    durationMs: number
    ip?: string
    userId?: string | null
    error?: string
  },
): void => {
  logger.info({
    type: 'request',
    ...fields,
  })
}
