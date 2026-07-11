import { desc, eq, gte, sql } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { pageAnalytics } from '../schema.ts'
import type { AnalyticsRepository } from '../../repositories/analytics.ts'

const selection = {
  path: pageAnalytics.path,
  views: pageAnalytics.views,
  lastViewedAt: pageAnalytics.lastViewedAt,
}

export const createSqliteAnalyticsRepository = (db: DB): AnalyticsRepository => ({
  async incrementBatch(batch) {
    if (batch.length === 0) return
    db.transaction(() => {
      const statement = db.$client.prepare(`
        INSERT INTO page_analytics(path, views, last_viewed_at)
        VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          views = views + excluded.views,
          last_viewed_at = excluded.last_viewed_at
      `)
      for (const row of batch) statement.run(row.path, row.views, row.lastViewedAt)
    })
  },

  async find(path) {
    return db.select(selection).from(pageAnalytics).where(eq(pageAnalytics.path, path)).get()
  },

  async summary(limit) {
    const totalViews = db
      .select({ total: sql<number>`coalesce(sum(${pageAnalytics.views}), 0)` })
      .from(pageAnalytics)
      .get()?.total ?? 0
    const topPages = db.select(selection)
      .from(pageAnalytics)
      .orderBy(desc(pageAnalytics.views), desc(pageAnalytics.lastViewedAt))
      .limit(limit)
      .all()
    return { totalViews, topPages }
  },

  async popular(cutoff, limit) {
    return db.select(selection)
      .from(pageAnalytics)
      .where(gte(pageAnalytics.lastViewedAt, cutoff))
      .orderBy(desc(pageAnalytics.views), desc(pageAnalytics.lastViewedAt))
      .limit(limit)
      .all()
  },
})
