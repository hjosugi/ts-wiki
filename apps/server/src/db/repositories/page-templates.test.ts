import { afterEach, describe, expect, test } from 'bun:test'
import type { DB } from '../client.ts'
import { createLibsqlDb, createSqliteDb } from '../client.ts'
import { createSqlitePageTemplateRepository } from './page-templates.ts'

const databases: DB[] = []

afterEach(() => {
  while (databases.length) databases.pop()?.$client.close()
})

const drivers = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
] as const

describe.each(drivers)('%s page template repository contract', (_driver, create) => {
  test('lists, finds, updates, and deletes templates asynchronously', async () => {
    const db = create()
    databases.push(db)
    const repository = createSqlitePageTemplateRepository(db)
    const template = {
      id: 'template-1',
      name: 'Runbook',
      description: 'Operational steps',
      icon: '📘',
      content: '# Runbook',
      metadata: '{}',
      createdBy: null,
      createdAt: 10,
      updatedAt: 10,
    }

    await repository.insert(template)
    expect(await repository.findById(template.id)).toEqual(template)
    expect(await repository.list()).toEqual([template])

    await repository.update(template.id, {
      name: 'Incident runbook',
      description: template.description,
      icon: template.icon,
      content: '# Incident',
      metadata: '{"status":"verified"}',
      updatedAt: 20,
    })
    expect(await repository.findById(template.id)).toMatchObject({
      name: 'Incident runbook',
      content: '# Incident',
      updatedAt: 20,
    })

    await repository.delete(template.id)
    expect(await repository.findById(template.id)).toBeUndefined()
  })
})
