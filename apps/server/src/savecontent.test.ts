import { describe, test, expect } from 'bun:test'
import { sql } from 'drizzle-orm'
import type { Principal } from '@wiki/core'
import { createDb, type DB } from './db/client.ts'
import { createServices } from './services/index.ts'
import { pageRevisions } from './db/schema.ts'

const admin: Principal = { id: 'a', role: 'admin' }
const revisions = (db: DB): number =>
  db.select({ c: sql<number>`count(*)` }).from(pageRevisions).get()?.c ?? 0

describe('saveContent (collab autosave)', () => {
  test('refreshes content + search index but adds NO revision', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    pages.create({ path: 'p', title: 'P', content: 'original kiwi' }, admin)
    const before = revisions(db) // 1 (the 'created' snapshot)

    const r = pages.saveContent('p', 'autosaved papaya', admin)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.content).toBe('autosaved papaya')

    expect(revisions(db)).toBe(before) // crucial: no revision spam
    expect(search.search('papaya').hits.length).toBe(1) // reindexed
    expect(search.search('kiwi').hits.length).toBe(0)
  })

  test('forbidden for anonymous, not_found for a missing page', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    expect(pages.saveContent('p', 'x', null).ok).toBe(false)
    expect(pages.saveContent('missing', 'x', admin).ok).toBe(false)
  })
})
