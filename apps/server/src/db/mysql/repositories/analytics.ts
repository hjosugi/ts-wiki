import { desc, eq, gte, sql } from 'drizzle-orm'
import type { MysqlDb } from '../client.ts'
import { pageAnalytics } from '../schema.ts'
import type { AnalyticsRepository } from '../../../repositories/analytics.ts'

const selection = {
  path: pageAnalytics.path,
  views: pageAnalytics.views,
  lastViewedAt: pageAnalytics.lastViewedAt,
}

/** MySQL implementation of the driver-neutral analytics contract. */
export const createMysqlAnalyticsRepository = (db: MysqlDb): AnalyticsRepository => ({
  async incrementBatch(batch) {
    if (batch.length === 0) return
    await db
      .insert(pageAnalytics)
      .values(batch.map((row) => ({ path: row.path, views: row.views, lastViewedAt: row.lastViewedAt })))
      // MySQL's analogue of Postgres `excluded.x` is `VALUES(x)` (the row that
      // would have been inserted). It takes the bare column name.
      .onDuplicateKeyUpdate({
        set: {
          views: sql`${pageAnalytics.views} + values(${sql.identifier(pageAnalytics.views.name)})`,
          lastViewedAt: sql`values(${sql.identifier(pageAnalytics.lastViewedAt.name)})`,
        },
      })
  },

  async find(path) {
    const [row] = await db.select(selection).from(pageAnalytics).where(eq(pageAnalytics.path, path)).limit(1)
    return row
  },

  async summary(limit) {
    const [totals] = await db
      .select({ total: sql<number>`coalesce(sum(${pageAnalytics.views}), 0)` })
      .from(pageAnalytics)
    const totalViews = Number(totals?.total ?? 0)
    const topPages = await db
      .select(selection)
      .from(pageAnalytics)
      .orderBy(desc(pageAnalytics.views), desc(pageAnalytics.lastViewedAt))
      .limit(limit)
    return { totalViews, topPages }
  },

  async popular(cutoff, limit) {
    return db
      .select(selection)
      .from(pageAnalytics)
      .where(gte(pageAnalytics.lastViewedAt, cutoff))
      .orderBy(desc(pageAnalytics.views), desc(pageAnalytics.lastViewedAt))
      .limit(limit)
  },
})
