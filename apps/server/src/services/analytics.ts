import { desc, sql } from 'drizzle-orm'
import { type AppError, type Principal, type Result, can, err, forbidden, ok } from '@ts-wiki/core'
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
  summary(principal: Principal | null, limit?: number): Result<AnalyticsSummary, AppError>
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
      if (!can(principal, 'page:read', { path })) return err(forbidden())
      upsert.run(path, Date.now())
      return ok(undefined)
    },
    summary(principal, limit = 10) {
      if (!can(principal, 'admin:access')) return err(forbidden())
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
  }
}
