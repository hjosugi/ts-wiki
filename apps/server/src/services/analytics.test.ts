import { describe, expect, test } from 'bun:test'
import type { Principal } from '@ts-wiki/core'
import { createDb } from '../db/client.ts'
import { createAnalyticsService } from './analytics.ts'

const admin: Principal = { id: 'admin-1', role: 'admin' }
const viewer: Principal = { id: 'viewer-1', role: 'viewer' }

describe('analytics service', () => {
  test('records page views and summarizes top pages for admins', () => {
    const analytics = createAnalyticsService(createDb(':memory:'))

    expect(analytics.recordPageView('docs/a', viewer).ok).toBe(true)
    expect(analytics.recordPageView('docs/a', viewer).ok).toBe(true)
    expect(analytics.recordPageView('docs/b', viewer).ok).toBe(true)
    expect(analytics.page('docs/missing')).toEqual({ path: 'docs/missing', views: 0, lastViewedAt: null })

    const forbidden = analytics.summary(viewer)
    expect(forbidden.ok).toBe(false)
    if (!forbidden.ok) expect(forbidden.error.kind).toBe('forbidden')

    const summary = analytics.summary(admin, 1)
    expect(summary.ok).toBe(true)
    if (!summary.ok) throw new Error('analytics summary failed')
    expect(summary.value.totalViews).toBe(3)
    expect(summary.value.topPages).toEqual([
      { path: 'docs/a', views: 2, lastViewedAt: expect.any(Number) },
    ])
  })
})
