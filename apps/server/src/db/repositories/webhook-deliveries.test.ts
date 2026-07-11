import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import type { WebhookDeliveryRecord } from '../../repositories/webhooks.ts'
import { createSqliteWebhookDeliveryRepository } from './webhook-deliveries.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const delivery = (
  id: string,
  createdAt: number,
  status: WebhookDeliveryRecord['status'] = 'pending',
  attempts = 0,
  nextAttemptAt: number | null = createdAt,
): WebhookDeliveryRecord => ({
  id,
  subscriptionId: 'subscription-1',
  eventId: `event-${id}`,
  eventType: 'page.updated',
  payload: '{}',
  status,
  attempts,
  nextAttemptAt,
  responseStatus: null,
  responseBody: null,
  error: null,
  createdAt,
  updatedAt: createdAt,
  deliveredAt: null,
})

describe.each(drivers)('%s webhook delivery repository contract', (_driver, create) => {
  test('stores, filters, orders, updates, and selects retryable due deliveries', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqliteWebhookDeliveryRepository(db)

    await repository.insert(delivery('older', 10, 'failed', 1, 50))
    await repository.insert(delivery('newer', 20, 'pending', 0, 100))
    await repository.insert(delivery('done', 30, 'succeeded', 1, null))
    await repository.insert(delivery('exhausted', 40, 'failed', 3, 40))

    expect((await repository.list(undefined, 2)).map((row) => row.id)).toEqual(['exhausted', 'done'])
    expect((await repository.list('failed', 10)).map((row) => row.id)).toEqual(['exhausted', 'older'])
    expect((await repository.listDue(75, 10, 3)).map((row) => row.id)).toEqual(['older'])

    await repository.update('older', {
      status: 'succeeded',
      attempts: 2,
      nextAttemptAt: null,
      responseStatus: 200,
      responseBody: 'ok',
      error: null,
      updatedAt: 80,
      deliveredAt: 80,
    })
    expect(await repository.findById('older')).toMatchObject({
      status: 'succeeded', attempts: 2, nextAttemptAt: null, responseStatus: 200, responseBody: 'ok', deliveredAt: 80,
    })
    expect(await repository.findById('missing')).toBeUndefined()
  })
})
