import { rateLimited, type AppError } from '@kawaii-wiki/core'

interface RateLimitStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface RateLimitDatabase {
  prepare(sql: string): RateLimitStatement
  exec(sql: string): unknown
}

interface RateLimitBucket {
  hits: number[]
  lastSeen: number
}

export interface RateLimiter {
  check(key: string): boolean
  size(): number
  sweep(now?: number): void
}

export const createRateLimiter = (
  limit: number,
  windowMs: number,
  maxBuckets = 10_000,
  clock: () => number = () => Date.now(),
): RateLimiter => {
  const buckets = new Map<string, RateLimitBucket>()
  let lastSweep = 0

  const sweep = (now = clock()): void => {
    if (now - lastSweep < windowMs) return
    lastSweep = now
    const cutoff = now - windowMs
    for (const [key, bucket] of buckets) {
      bucket.hits = bucket.hits.filter((hit) => hit > cutoff)
      if (bucket.hits.length === 0 || bucket.lastSeen <= cutoff) buckets.delete(key)
    }
  }

  const trimOverflow = (): void => {
    while (buckets.size > maxBuckets) {
      const oldest = buckets.keys().next().value
      if (!oldest) return
      buckets.delete(oldest)
    }
  }

  return {
    check(key) {
      const now = clock()
      sweep(now)
      const cutoff = now - windowMs
      const bucket = buckets.get(key) ?? { hits: [], lastSeen: now }
      bucket.hits = bucket.hits.filter((hit) => hit > cutoff)
      bucket.lastSeen = now
      if (bucket.hits.length >= limit) {
        buckets.delete(key)
        buckets.set(key, bucket)
        return false
      }
      bucket.hits.push(now)
      buckets.delete(key)
      buckets.set(key, bucket)
      trimOverflow()
      return true
    },
    size() {
      return buckets.size
    },
    sweep,
  }
}

const rowNumber = (row: unknown, key: string): number => {
  const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[key] : 0
  return typeof value === 'number' ? value : Number(value ?? 0)
}

const withImmediateTransaction = <T>(database: RateLimitDatabase, fn: () => T): T => {
  let begun = false
  try {
    database.exec('BEGIN IMMEDIATE')
    begun = true
    const value = fn()
    database.exec('COMMIT')
    begun = false
    return value
  } catch (error) {
    if (begun) {
      try {
        database.exec('ROLLBACK')
      } catch {
        // Preserve the original failure; rollback can fail if SQLite already closed the transaction.
      }
    }
    throw error
  }
}

export const createDbRateLimiter = (
  database: RateLimitDatabase,
  limit: number,
  windowMs: number,
  maxBuckets = 10_000,
  clock: () => number = () => Date.now(),
): RateLimiter => {
  let lastSweep = 0
  const deleteExpired = database.prepare('DELETE FROM rate_limit_hits WHERE hit_at <= ?')
  const deleteExpiredForKey = database.prepare('DELETE FROM rate_limit_hits WHERE bucket_key = ? AND hit_at <= ?')
  const countKey = database.prepare('SELECT count(*) AS count FROM rate_limit_hits WHERE bucket_key = ? AND hit_at > ?')
  const insertHit = database.prepare('INSERT INTO rate_limit_hits (bucket_key, hit_at) VALUES (?, ?)')
  const countBuckets = database.prepare('SELECT count(DISTINCT bucket_key) AS count FROM rate_limit_hits WHERE hit_at > ?')
  const oldestBuckets = database.prepare(`
    SELECT bucket_key
    FROM rate_limit_hits
    GROUP BY bucket_key
    ORDER BY MAX(hit_at) ASC
    LIMIT ?
  `)
  const deleteBucket = database.prepare('DELETE FROM rate_limit_hits WHERE bucket_key = ?')

  const sweep = (now = clock()): void => {
    if (now - lastSweep < windowMs) return
    lastSweep = now
    deleteExpired.run(now - windowMs)
  }

  const trimOverflow = (cutoff: number): void => {
    const bucketCount = rowNumber(countBuckets.get(cutoff), 'count')
    const overflow = bucketCount - maxBuckets
    if (overflow <= 0) return
    for (const row of oldestBuckets.all(overflow)) {
      const bucketKey = row && typeof row === 'object' ? (row as { bucket_key?: unknown }).bucket_key : null
      if (typeof bucketKey === 'string') deleteBucket.run(bucketKey)
    }
  }

  return {
    check(key) {
      const now = clock()
      const cutoff = now - windowMs
      return withImmediateTransaction(database, () => {
        sweep(now)
        deleteExpiredForKey.run(key, cutoff)
        if (rowNumber(countKey.get(key, cutoff), 'count') >= limit) return false
        insertHit.run(key, now)
        trimOverflow(cutoff)
        return true
      })
    },
    size() {
      const now = clock()
      sweep(now)
      return rowNumber(countBuckets.get(now - windowMs), 'count')
    },
    sweep,
  }
}

/** Builds a rate limiter for a given attempt budget, hiding the driver choice. */
export type RateLimiterFactory = (limit: number) => RateLimiter

export interface RateLimiterFactoryOptions {
  readonly windowMs: number
  /**
   * When provided, hits are persisted to this database so limits hold across app
   * instances sharing it. When null the limiter is in-memory — the only option
   * for drivers without a synchronous `RateLimitDatabase` (e.g. Postgres).
   */
  readonly database?: RateLimitDatabase | null
}

/**
 * Driver-neutral rate-limiter factory. Callers pick DB-backed vs in-memory by
 * supplying (or omitting) a `database`, so the app layer never branches on the
 * concrete database driver.
 */
export const createRateLimiterFactory = ({ windowMs, database }: RateLimiterFactoryOptions): RateLimiterFactory =>
  (limit) =>
    database ? createDbRateLimiter(database, limit, windowMs) : createRateLimiter(limit, windowMs)

export interface RequestIpServer {
  requestIP(request: Request): { address: string } | null
}

export const firstForwardedIp = (request: Request): string | null =>
  request.headers.get('cf-connecting-ip')?.trim() ||
  request.headers.get('x-real-ip')?.trim() ||
  request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ||
  null

export const directClientIp = (request: Request, server: RequestIpServer | null | undefined): string =>
  server?.requestIP(request)?.address ?? 'local'

export const clientIp = (
  request: Request,
  server: RequestIpServer | null | undefined,
  trustProxyHeaders: boolean,
): string => trustProxyHeaders ? (firstForwardedIp(request) ?? directClientIp(request, server)) : directClientIp(request, server)

export const rateLimitError = (message = 'Too many requests; try again later'): AppError =>
  rateLimited(message)

export const authRateLimitError = (): AppError =>
  rateLimitError('Too many authentication attempts; try again later')
