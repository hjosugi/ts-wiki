import { rateLimited, type AppError } from '@ts-wiki/core'

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

export const authRateLimitError = (): AppError =>
  rateLimited('Too many authentication attempts; try again later')
