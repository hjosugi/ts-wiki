export interface PageAnalyticsRecord {
  readonly path: string
  readonly views: number
  readonly lastViewedAt: number | null
}

export interface PageAnalyticsIncrement {
  readonly path: string
  readonly views: number
  readonly lastViewedAt: number
}

export interface AnalyticsSummaryRecord {
  readonly totalViews: number
  readonly topPages: PageAnalyticsRecord[]
}

export interface AnalyticsRepository {
  incrementBatch(batch: readonly PageAnalyticsIncrement[]): Promise<void>
  find(path: string): Promise<PageAnalyticsRecord | undefined>
  summary(limit: number): Promise<AnalyticsSummaryRecord>
  popular(cutoff: number, limit: number): Promise<PageAnalyticsRecord[]>
}
