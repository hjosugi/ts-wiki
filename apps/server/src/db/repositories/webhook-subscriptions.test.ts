import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import type { WebhookSubscriptionRecord } from '../../repositories/webhooks.ts'
import { createSqliteWebhookSubscriptionRepository } from './webhook-subscriptions.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const subscription = (id: string, createdAt: number, enabled = true): WebhookSubscriptionRecord => ({
  id,
  name: id,
  targetUrl: `https://example.com/${id}`,
  secret: `${id}-secret`,
  eventTypes: '["page.updated"]',
  enabled,
  createdAt,
  updatedAt: createdAt,
})

describe.each(drivers)('%s webhook subscription repository contract', (_driver, create) => {
  test('stores, orders, filters, updates, and deletes subscriptions asynchronously', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteWebhookSubscriptionRepository(db)

    await repository.insert(subscription('later', 20, false))
    await repository.insert(subscription('earlier', 10))
    expect((await repository.list()).map((row) => row.id)).toEqual(['earlier', 'later'])
    expect((await repository.listEnabled()).map((row) => row.id)).toEqual(['earlier'])
    expect(await repository.findById('missing')).toBeUndefined()

    await repository.update('later', { enabled: true, name: 'Updated', updatedAt: 30 })
    expect(await repository.findById('later')).toMatchObject({ enabled: true, name: 'Updated', updatedAt: 30 })
    expect((await repository.listEnabled()).map((row) => row.id)).toEqual(['earlier', 'later'])

    await repository.delete('earlier')
    expect(await repository.findById('earlier')).toBeUndefined()
  })
})
