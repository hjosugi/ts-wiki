/**
 * MySQL webhook/automation repository contract tests — integration. Env-gated.
 * Mirrors `../postgres/repositories-webhooks.test.ts`; own isolated database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { pages } from './schema.ts'
import { createMysqlContractDb, testMysqlUrl, type MysqlContractDb } from './test-support.ts'
import { createMysqlWebhookSubscriptionRepository } from './repositories/webhook-subscriptions.ts'
import { createMysqlWebhookDeliveryRepository } from './repositories/webhook-deliveries.ts'
import { createMysqlWebhookAutomationRepository } from './repositories/webhook-automation.ts'
import type { WebhookDeliveryRecord, WebhookSubscriptionRecord, AutomationRuleRecord } from '../../repositories/webhooks.ts'

const subscription = (over: Partial<WebhookSubscriptionRecord> = {}): WebhookSubscriptionRecord => ({
  id: 's1', name: 'Hook', targetUrl: 'https://x', secret: 'sec', eventTypes: 'page.updated',
  enabled: true, createdAt: 1, updatedAt: 1, ...over,
})

const delivery = (over: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord => ({
  id: 'd1', subscriptionId: 's1', eventId: 'e1', eventType: 'page.updated', payload: '{}',
  status: 'pending', attempts: 0, nextAttemptAt: 10, responseStatus: null, responseBody: null,
  error: null, createdAt: 1, updatedAt: 1, deliveredAt: null, ...over,
})

const rule = (over: Partial<AutomationRuleRecord> = {}): AutomationRuleRecord => ({
  id: 'r1', name: 'Rule', type: 'event-rule', enabled: true, priority: 0, stopOnMatch: false,
  config: '{}', createdAt: 1, updatedAt: 1, ...over,
})

// MySQL keeps no DB default on the page body columns, so the raw fixture supplies them.
const seedPage = () => ({ id: 'p1', path: 'docs/a', title: 'A', content: '', renderedHtml: '', toc: '[]', labels: '[]', createdAt: 1, updatedAt: 1 })

describe.skipIf(!testMysqlUrl)('mysql webhook repository contracts', () => {
  let harness: MysqlContractDb
  beforeAll(async () => { harness = await createMysqlContractDb('kw_webhook_contract') }, 30_000)
  beforeEach(async () => { await harness.reset() }, 30_000)
  afterAll(async () => { await harness?.close() }, 30_000)

  test('subscriptions: crud, ordering, and enabled filter', async () => {
    const repo = createMysqlWebhookSubscriptionRepository(harness.db)
    await repo.insert(subscription({ id: 's1', createdAt: 1, enabled: true }))
    await repo.insert(subscription({ id: 's2', createdAt: 2, enabled: false }))
    expect((await repo.list()).map((s) => s.id)).toEqual(['s1', 's2'])
    expect((await repo.listEnabled()).map((s) => s.id)).toEqual(['s1'])
    expect((await repo.findById('s2'))?.enabled).toBe(false)

    await repo.update('s2', { enabled: true, name: 'Renamed', updatedAt: 5 })
    expect((await repo.listEnabled()).map((s) => s.id)).toEqual(['s1', 's2'])
    expect((await repo.findById('s2'))?.name).toBe('Renamed')

    await repo.delete('s1')
    expect((await repo.list()).map((s) => s.id)).toEqual(['s2'])
  })

  test('deliveries: crud, status filter, and due selection', async () => {
    const repo = createMysqlWebhookDeliveryRepository(harness.db)
    await repo.insert(delivery({ id: 'd1', status: 'pending', createdAt: 1, nextAttemptAt: 10, attempts: 0 }))
    await repo.insert(delivery({ id: 'd2', status: 'failed', createdAt: 2, nextAttemptAt: 5, attempts: 2 }))
    await repo.insert(delivery({ id: 'd3', status: 'succeeded', createdAt: 3, nextAttemptAt: 1, attempts: 1 }))

    expect((await repo.list(undefined, 10)).map((d) => d.id)).toEqual(['d3', 'd2', 'd1']) // desc createdAt
    expect((await repo.list('failed', 10)).map((d) => d.id)).toEqual(['d2'])
    expect((await repo.findById('d1'))?.status).toBe('pending')

    // due: nextAttemptAt <= dueAt, status != succeeded, attempts < maxAttempts
    expect((await repo.listDue(10, 10, 5)).map((d) => d.id)).toEqual(['d2', 'd1']) // asc nextAttemptAt
    expect((await repo.listDue(10, 10, 2)).map((d) => d.id)).toEqual(['d1']) // d2 hit max attempts

    await repo.update('d1', { status: 'succeeded', attempts: 1, updatedAt: 9, deliveredAt: 9 })
    expect((await repo.findById('d1'))?.deliveredAt).toBe(9)
    expect((await repo.listDue(10, 10, 5)).map((d) => d.id)).toEqual(['d2'])
  })

  test('automation: page lookups and rule ordering/crud', async () => {
    await harness.db.insert(pages).values(seedPage())
    const repo = createMysqlWebhookAutomationRepository(harness.db)
    expect((await repo.findPageById('p1'))?.path).toBe('docs/a')
    expect((await repo.findPageByPath('docs/a'))?.id).toBe('p1')
    expect(await repo.findPageByPath('missing')).toBeUndefined()

    await repo.insertRule(rule({ id: 'r1', priority: 2, createdAt: 1, enabled: true }))
    await repo.insertRule(rule({ id: 'r2', priority: 1, createdAt: 2, enabled: false }))
    await repo.insertRule(rule({ id: 'r3', priority: 1, createdAt: 1, enabled: true }))
    // ordered by priority asc, createdAt asc
    expect((await repo.listRules()).map((r) => r.id)).toEqual(['r3', 'r2', 'r1'])
    expect((await repo.listEnabledRules()).map((r) => r.id)).toEqual(['r3', 'r1'])
    expect((await repo.findRule('r2'))?.enabled).toBe(false)

    await repo.updateRule('r2', { enabled: true, priority: 0, updatedAt: 5 })
    expect((await repo.listEnabledRules()).map((r) => r.id)).toEqual(['r2', 'r3', 'r1'])
    await repo.deleteRule('r1')
    expect((await repo.listRules()).map((r) => r.id)).toEqual(['r2', 'r3'])
  })
})
