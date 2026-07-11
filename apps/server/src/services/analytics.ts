import { type AppError, type Principal, type Result, ok, requirePermission } from '@kawaii-wiki/core'
import type { AnalyticsRepository } from '../repositories/analytics.ts'
import { unrefTimer } from '../utils/timers.ts'

export interface PageInsight {
  readonly path: string
  readonly views: number
  readonly lastViewedAt: number | null
}

export interface AnalyticsSummary {
  readonly totalViews: number
  readonly topPages: PageInsight[]
}

export interface AnalyticsService {
  recordPageView(path: string, principal: Principal | null): Result<void, AppError>
  page(path: string): Promise<PageInsight>
  summary(principal: Principal | null, limit?: number): Promise<Result<AnalyticsSummary, AppError>>
  popular(days?: number, limit?: number): Promise<PageInsight[]>
  flush(): Promise<void>
}

export const createAnalyticsService = (repository: AnalyticsRepository): AnalyticsService => {
  const pending = new Map<string, { views: number; lastViewedAt: number }>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const flush = async (): Promise<void> => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    const batch = [...pending.entries()].map(([path, value]) => ({ path, ...value }))
    pending.clear()
    if (!batch.length) return
    await repository.incrementBatch(batch)
  }

  const flushBestEffort = async (): Promise<void> => {
    try {
      await flush()
    } catch {
      // A buffered view is intentionally lossy. In particular, an application
      // instance may have shut down and closed its database before this timer.
    }
  }

  const scheduleFlush = (): void => {
    if (flushTimer) return
    flushTimer = setTimeout(() => void flushBestEffort(), 1_000)
    unrefTimer(flushTimer)
  }

  return {
    recordPageView(path, principal) {
      const allowed = requirePermission(principal, 'page:read', { path })
      if (!allowed.ok) return allowed
      const recordedAt = Date.now()
      const current = pending.get(path)
      pending.set(path, { views: (current?.views ?? 0) + 1, lastViewedAt: recordedAt })
      scheduleFlush()
      return ok(undefined)
    },
    async page(path) {
      const persisted = await repository.find(path) ?? { path, views: 0, lastViewedAt: null }
      const buffered = pending.get(path)
      return buffered
        ? { path, views: persisted.views + buffered.views, lastViewedAt: buffered.lastViewedAt }
        : persisted
    },
    async summary(principal, limit = 10) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      await flush()
      return ok(await repository.summary(limit))
    },
    async popular(days = 7, limit = 10) {
      await flush()
      const cappedDays = Math.min(Math.max(Math.trunc(days), 1), 365)
      const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50)
      const cutoff = Date.now() - cappedDays * 24 * 60 * 60 * 1000
      return repository.popular(cutoff, cappedLimit)
    },
    flush,
  }
}
