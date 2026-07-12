import { describe, test, expect } from 'bun:test'
import { sql } from 'drizzle-orm'
import type { Principal } from '@kawaii-wiki/core'
import { createDb, type DB } from './db/client.ts'
import { createServices } from './db/services.ts'
import { pageRevisions, pages as pageRows } from './db/schema.ts'

const admin: Principal = { id: 'a', role: 'admin' }
const revisions = (db: DB): number =>
  db.select({ c: sql<number>`count(*)` }).from(pageRevisions).get()?.c ?? 0

describe('saveContent (collab autosave)', () => {
  test('refreshes content + search index but adds NO revision', async () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    await pages.create({ path: 'p', title: 'P', content: 'original kiwi' }, admin)
    const before = revisions(db) // 1 (the 'created' snapshot)

    const r = await pages.saveContent('p', 'autosaved papaya', admin)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.content).toBe('autosaved papaya')

    expect(revisions(db)).toBe(before) // crucial: no revision spam
    expect(search.search('papaya').hits.length).toBe(1) // reindexed
    expect(search.search('kiwi').hits.length).toBe(0)
  })

  test('forbidden for anonymous, not_found for a missing page', async () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    expect((await pages.saveContent('p', 'x', null)).ok).toBe(false)
    expect((await pages.saveContent('missing', 'x', admin)).ok).toBe(false)
  })

  test('rejects stale collaborative autosaves after an external write', async () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    const created = await pages.create({ path: 'p', title: 'P', content: 'seed' }, admin)
    if (!created.ok) throw new Error('seed failed')
    const collabSeedUpdatedAt = created.value.updatedAt

    await Bun.sleep(2)
    const external = await pages.update('p', { content: 'external update' }, admin)
    expect(external.ok).toBe(true)

    const stale = await pages.saveContent('p', 'stale collab text', admin, collabSeedUpdatedAt)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.kind).toBe('conflict')
    const current = await pages.getByPath('p')
    expect(current.ok).toBe(true)
    if (current.ok) expect(current.value.content).toBe('external update')
  })

  test('runs the normal page validator before autosaving', async () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    const now = Date.now()
    db.insert(pageRows)
      .values({
        id: 'bad-page',
        path: 'bad',
        title: '',
        description: '',
        content: 'seed',
        renderedHtml: '',
        toc: '[]',
        contentType: 'markdown',
        lifecycle: 'active',
        labels: '[]',
        status: 'draft',
        ownerId: null,
        reviewAt: null,
        spaceKey: 'main',
        locale: 'und',
        authorId: admin.id,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const result = await pages.saveContent('bad', 'autosaved anyway', admin)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('validation')
    const current = await pages.getByPath('bad')
    expect(current.ok).toBe(true)
    if (current.ok) expect(current.value.content).toBe('seed')
  })
})
