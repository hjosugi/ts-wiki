import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { pages } from '../schema.ts'
import type { AutomationRuleRecord } from '../../repositories/webhooks.ts'
import { createSqliteWebhookAutomationRepository } from './webhook-automation.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

const rule = (id: string, priority: number, enabled = true): AutomationRuleRecord => ({
  id,
  name: id,
  type: 'event-rule',
  enabled,
  priority,
  stopOnMatch: false,
  config: '{"trigger":"page.updated","actions":{}}',
  createdAt: priority + 100,
  updatedAt: priority + 100,
})

describe.each(drivers)('%s webhook automation repository contract', (_driver, create) => {
  test('looks up event pages and manages ordered automation rules asynchronously', async () => {
    const db = create()
    databases.push(db)
    db.insert(pages).values({
      id: 'page-1', path: 'docs/one', title: 'One', description: '', icon: '', coverUrl: '', coverPosition: 'center',
      content: '', renderedHtml: '', toc: '[]', contentType: 'markdown', lifecycle: 'active', status: 'verified',
      labels: '[]', ownerId: null, reviewAt: null, publishAt: null, navOrder: null, pinned: false,
      spaceKey: 'docs', locale: 'ja', authorId: null, createdAt: 1, updatedAt: 1,
    }).run()
    const repository = createSqliteWebhookAutomationRepository(db)

    expect(await repository.findPageById('page-1')).toMatchObject({ path: 'docs/one' })
    expect(await repository.findPageByPath('docs/one')).toMatchObject({ id: 'page-1' })
    expect(await repository.findPageById('missing')).toBeUndefined()

    await repository.insertRule(rule('later', 20))
    await repository.insertRule(rule('first', 10))
    await repository.insertRule(rule('disabled', 0, false))
    expect((await repository.listRules()).map((row) => row.id)).toEqual(['disabled', 'first', 'later'])
    expect((await repository.listEnabledRules()).map((row) => row.id)).toEqual(['first', 'later'])

    await repository.updateRule('later', { name: 'Updated', priority: 5, stopOnMatch: true, updatedAt: 200 })
    expect(await repository.findRule('later')).toMatchObject({ name: 'Updated', priority: 5, stopOnMatch: true, updatedAt: 200 })
    await repository.deleteRule('first')
    expect(await repository.findRule('first')).toBeUndefined()
  })
})
