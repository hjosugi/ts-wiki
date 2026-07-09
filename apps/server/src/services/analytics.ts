import { desc, eq, gte, sql } from 'drizzle-orm'
import { type AppError, type Principal, type Result, ok, requirePermission } from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { pageAnalytics } from '../db/schema.ts'

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
  page(path: string): PageInsight
  summary(principal: Principal | null, limit?: number): Result<AnalyticsSummary, AppError>
  popular(days?: number, limit?: number): PageInsight[]
}

export const createAnalyticsService = (db: DB): AnalyticsService => {
  const upsert = db.$client.prepare(`
    INSERT INTO page_analytics(path, views, last_viewed_at)
    VALUES (?, 1, ?)
    ON CONFLICT(path) DO UPDATE SET
      views = views + 1,
      last_viewed_at = excluded.last_viewed_at
  `)

  return {
    recordPageView(path, principal) {
      const allowed = requirePermission(principal, 'page:read', { path })
      if (!allowed.ok) return allowed
      upsert.run(path, Date.now())
      return ok(undefined)
    },
    page(path) {
      return db
        .select({
          path: pageAnalytics.path,
          views: pageAnalytics.views,
          lastViewedAt: pageAnalytics.lastViewedAt,
        })
        .from(pageAnalytics)
        .where(eq(pageAnalytics.path, path))
        .get() ?? { path, views: 0, lastViewedAt: null }
    },
    summary(principal, limit = 10) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const totalViews =
        db.select({ total: sql<number>`coalesce(sum(${pageAnalytics.views}), 0)` }).from(pageAnalytics).get()
          ?.total ?? 0
      const topPages = db
        .select({
          path: pageAnalytics.path,
          views: pageAnalytics.views,
          lastViewedAt: pageAnalytics.lastViewedAt,
        })
        .from(pageAnalytics)
        .orderBy(desc(pageAnalytics.views), desc(pageAnalytics.lastViewedAt))
        .limit(limit)
        .all()
      return ok({ totalViews, topPages })
    },
    popular(days = 7, limit = 10) {
      const cappedDays = Math.min(Math.max(Math.trunc(days), 1), 365)
      const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50)
      const cutoff = Date.now() - cappedDays * 24 * 60 * 60 * 1000
      return db
        .select({
          path: pageAnalytics.path,
          views: pageAnalytics.views,
          lastViewedAt: pageAnalytics.lastViewedAt,
        })
        .from(pageAnalytics)
        .where(gte(pageAnalytics.lastViewedAt, cutoff))
        .orderBy(desc(pageAnalytics.views), desc(pageAnalytics.lastViewedAt))
        .limit(cappedLimit)
        .all()
    },
  }
}
