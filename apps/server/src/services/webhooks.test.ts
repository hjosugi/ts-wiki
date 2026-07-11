import { describe, expect, test } from 'bun:test'
import type { Principal } from '@kawaii-wiki/core'
import { createDb } from '../db/client.ts'
import { createSqliteWebhookSubscriptionRepository } from '../db/repositories/webhook-subscriptions.ts'
import { createSqliteWebhookDeliveryRepository } from '../db/repositories/webhook-deliveries.ts'
import { createSqliteWebhookAutomationRepository } from '../db/repositories/webhook-automation.ts'
import { createWebhookService, type WebhookFetcher } from './webhooks.ts'

const admin: Principal = { id: 'admin-1', role: 'admin' }

describe('webhook service', () => {
  test('records failed deliveries and retries due deliveries with signed requests', async () => {
    let now = 1_000
    const calls: Array<{ url: string; headers: Headers; body: string | null }> = []
    const fetcher: WebhookFetcher = async (url, init) => {
      calls.push({
        url,
        headers: new Headers(init.headers),
        body: typeof init.body === 'string' ? init.body : null,
      })
      return calls.length === 1
        ? new Response('temporary failure', { status: 500, statusText: 'temporary failure' })
        : new Response('ok', { status: 200 })
    }
    const db = createDb(':memory:')
    const webhooks = createWebhookService(
      createSqliteWebhookSubscriptionRepository(db),
      createSqliteWebhookDeliveryRepository(db),
      createSqliteWebhookAutomationRepository(db),
      {
      now: () => now,
      fetcher,
      resolver: async () => ['93.184.216.34'],
      policy: { maxAttempts: 2, backoffMs: [250], maxResponseBytes: 64, maxErrorBytes: 64 },
      },
    )

    const subscription = await webhooks.createSubscription(admin, {
      name: 'Deploy hook',
      targetUrl: 'https://example.com/hooks/deploy',
      secret: 'super-secret',
      eventTypes: ['page.updated'],
    })
    expect(subscription.ok).toBe(true)
    if (!subscription.ok) throw new Error('subscription create failed')

    const published = await webhooks.publish({
      type: 'page.updated',
      actorId: 'user-1',
      data: { path: 'docs/a' },
    })
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      status: 'pending',
      attempts: 0,
      responseStatus: null,
      nextAttemptAt: 1_000,
    })
    await Bun.sleep(0)
    const firstAttempt = await webhooks.listDeliveries(admin)
    expect(firstAttempt.ok).toBe(true)
    if (!firstAttempt.ok) throw new Error('delivery list failed')
    expect(firstAttempt.value[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      responseStatus: 500,
      nextAttemptAt: 1_250,
    })
    expect(calls[0]?.url).toBe('https://example.com/hooks/deploy')
    expect(calls[0]?.headers.get('x-ts-wiki-event')).toBe('page.updated')
    expect(calls[0]?.headers.get('x-ts-wiki-signature')).toMatch(/^sha256=/)
    expect(calls[0]?.body).toContain('"path":"docs/a"')

    expect(await webhooks.processDueDeliveries()).toHaveLength(0)

    now = 1_250
    const retried = await webhooks.processDueDeliveries()
    expect(retried).toHaveLength(1)
    expect(retried[0]).toMatchObject({
      id: published[0]?.id,
      status: 'succeeded',
      attempts: 2,
      responseStatus: 200,
      responseBody: 'ok',
      nextAttemptAt: null,
    })
    expect(calls).toHaveLength(2)
  })
})
