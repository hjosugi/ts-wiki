import { describe, test, expect } from 'bun:test'
import type { Principal } from '@ts-wiki/core'
import { createDb } from './db/client.ts'
import { createServices } from './services/index.ts'

const admin: Principal = { id: 'admin-1', role: 'admin' }
const viewer: Principal = { id: 'viewer-1', role: 'viewer' }
const anon = null

const tableCount = (db: ReturnType<typeof createDb>, table: string): number =>
  (db.$client.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count

describe('page + search slice (in-memory db)', () => {
  test('create renders, indexes, and is immediately findable', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)

    const created = pages.create(
      { path: 'Docs/Intro', title: 'Intro', content: '# Hello\n\nA searchable banana paragraph.' },
      admin,
    )
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.value.path).toBe('docs/intro')
      expect(created.value.renderedHtml).toContain('<h1')
    }

    // Readable immediately (render is part of the write, not fire-and-forget).
    const fetched = pages.getByPath('docs/intro')
    expect(fetched.ok).toBe(true)

    // Searchable immediately.
    const result = search.search('banana')
    expect(result.hits.length).toBe(1)
    expect(result.hits[0]?.path).toBe('docs/intro')
    expect(result.hits[0]?.snippet).toContain('<mark>')
  })

  test('anonymous users cannot create pages', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    const result = pages.create({ path: 'x', title: 'X', content: 'y' }, anon)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('forbidden')
  })

  test('duplicate paths conflict', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'dup', title: 'A', content: 'a' }, admin)
    const second = pages.create({ path: 'dup', title: 'B', content: 'b' }, admin)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.kind).toBe('conflict')
  })

  test('update snapshots history and re-indexes', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    pages.create({ path: 'p', title: 'P', content: 'original apple' }, admin)
    pages.update('p', { content: 'replaced orange' }, admin)

    expect(search.search('apple').hits.length).toBe(0)
    expect(search.search('orange').hits.length).toBe(1)
  })

  test('page metadata supports labels, status, review dates, and filtered search', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    const reviewAt = Date.UTC(2026, 6, 10)

    const created = pages.create(
      {
        path: 'Docs/Runbook',
        title: 'Runbook',
        content: 'banana recovery steps',
        labels: ['Ops', 'Incident Response'],
        status: 'verified',
        reviewAt,
        locale: 'en-US',
      },
      admin,
    )

    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.value.labels).toBe('["ops","incident-response"]')
      expect(created.value.status).toBe('verified')
      expect(created.value.reviewAt).toBe(reviewAt)
      expect(created.value.spaceKey).toBe('docs')
      expect(created.value.locale).toBe('en-us')
    }
    expect(pages.list()[0]).toMatchObject({
      path: 'docs/runbook',
      labels: '["ops","incident-response"]',
      status: 'verified',
      reviewAt,
      spaceKey: 'docs',
      locale: 'en-us',
    })
    expect(search.search('banana', 20, {
      pathPrefix: 'docs',
      label: 'ops',
      status: 'verified',
      spaceKey: 'docs',
      locale: 'en-us',
    }).hits.length).toBe(1)
    expect(search.search('banana', 20, { label: 'missing' }).hits.length).toBe(0)
    expect(pages.spaces()).toContainEqual(expect.objectContaining({ key: 'docs', pages: 1 }))
  })

  test('move changes the page path and preserves search index', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    pages.create({ path: 'old/path', title: 'Movable', content: 'portable pear' }, admin)
    pages.create({
      path: 'home',
      title: 'Home',
      content: 'See [[Old/Path|old page]] and [legacy](/old/path#details).',
    }, admin)

    const moved = pages.move('old/path', 'New/Path', admin)

    expect(moved.ok).toBe(true)
    if (moved.ok) expect(moved.value.path).toBe('new/path')
    expect(pages.getByPath('old/path').ok).toBe(false)
    expect(pages.getByPath('new/path').ok).toBe(true)
    expect(search.search('pear').hits[0]?.path).toBe('new/path')
    const home = pages.getByPath('home')
    expect(home.ok).toBe(true)
    if (home.ok) {
      expect(home.value.content).toContain('[[new/path|old page]]')
      expect(home.value.content).toContain('[legacy](/new/path#details)')
    }
    expect(pages.backlinks('new/path')).toEqual([
      { path: 'home', title: 'Home', label: 'old page', kind: 'wikilink' },
      { path: 'home', title: 'Home', label: 'new/path', kind: 'markdown' },
    ])
  })

  test('move refuses to overwrite an existing page', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'one', title: 'One', content: 'one' }, admin)
    pages.create({ path: 'two', title: 'Two', content: 'two' }, admin)

    const moved = pages.move('one', 'two', admin)

    expect(moved.ok).toBe(false)
    if (!moved.ok) expect(moved.error.kind).toBe('conflict')
    expect(pages.getByPath('one').ok).toBe(true)
  })

  test('graph exposes resolved and missing page links', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'home', title: 'Home', content: 'See [[Docs/Intro]] and [Missing](/missing).' }, admin)
    pages.create({ path: 'docs/intro', title: 'Intro', content: 'Back to [Home](/home).' }, admin)

    const graph = pages.graph()

    expect(graph.nodes).toContainEqual({ path: 'home', title: 'Home', kind: 'page' })
    expect(graph.nodes).toContainEqual({ path: 'docs/intro', title: 'Intro', kind: 'page' })
    expect(graph.nodes).toContainEqual({ path: 'missing', title: 'missing', kind: 'missing' })
    expect(graph.edges).toContainEqual({ source: 'home', target: 'docs/intro', kind: 'wikilink' })
    expect(graph.edges).toContainEqual({ source: 'home', target: 'missing', kind: 'markdown' })
    expect(graph.edges).toContainEqual({ source: 'docs/intro', target: 'home', kind: 'markdown' })
  })

  test('backlinks expose incoming page mentions', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'home', title: 'Home', content: 'See [[Docs/Intro|intro]].' }, admin)
    pages.create({ path: 'docs/intro', title: 'Intro', content: 'Hello.' }, admin)

    expect(pages.backlinks('docs/intro')).toEqual([
      { path: 'home', title: 'Home', label: 'intro', kind: 'wikilink' },
    ])
  })

  test('history returns stored revisions newest first', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'docs/history', title: 'History', content: 'one' }, admin)
    pages.update('docs/history', { content: 'two' }, admin)

    const history = pages.history('docs/history')

    expect(history.ok).toBe(true)
    if (history.ok) {
      expect(history.value.length).toBe(2)
      expect(history.value[0]?.action).toBe('updated')
      expect(history.value[0]?.content).toBe('one')
    }
  })

  test('restoreRevision applies an old revision as a new update', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'docs/history', title: 'History', content: 'one' }, admin)
    pages.update('docs/history', { content: 'two' }, admin)
    const history = pages.history('docs/history')
    expect(history.ok).toBe(true)
    if (!history.ok) return

    const restored = pages.restoreRevision('docs/history', history.value[0]!.id, admin)

    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.value.content).toBe('one')
    const nextHistory = pages.history('docs/history')
    expect(nextHistory.ok).toBe(true)
    if (nextHistory.ok) expect(nextHistory.value[0]?.action).toBe('updated')
  })

  test('events index extracts calendar fences across pages', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({
      path: 'calendar/sync',
      title: 'Sync',
      content: '```event\ntitle: Sync\nstart: 2026-07-05 10:00\n```',
    }, admin)

    expect(pages.events()).toEqual([
      {
        id: 'calendar/sync:0:sync',
        sourcePath: 'calendar/sync',
        block: 0,
        title: 'Sync',
        start: '2026-07-05 10:00',
      },
    ])
  })

  test('comments attach to active pages and expose mentions', () => {
    const db = createDb(':memory:')
    const { pages, comments } = createServices(db)
    pages.create({ path: 'docs/comments', title: 'Comments', content: 'hello' }, admin)

    const created = comments.create('docs/comments', 'Please review @Ada and @ops-team', viewer)

    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.value.mentions).toEqual(['ada', 'ops-team'])
      expect(created.value.authorId).toBe(viewer.id)
      expect(comments.update(created.value.id, 'edited', admin).ok).toBe(true)
      expect(comments.resolve(created.value.id, viewer).ok).toBe(true)
    }
    const listed = comments.list('docs/comments')
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.length).toBe(1)
    expect(comments.create('docs/comments', 'anonymous', anon).ok).toBe(false)
  })

  test('asset and analytics services enforce authorization directly', () => {
    const db = createDb(':memory:')
    const { assets, analytics } = createServices(db)

    expect(assets.record({
      id: 'asset-1',
      filename: 'secret.pdf',
      storageName: 'asset-1-secret.pdf',
      mime: 'application/pdf',
      size: 100,
      authorId: admin.id,
    }, viewer).ok).toBe(false)

    const recorded = assets.record({
      id: 'asset-1',
      filename: 'secret.pdf',
      storageName: 'asset-1-secret.pdf',
      mime: 'application/pdf',
      size: 100,
      authorId: admin.id,
    }, admin)
    expect(recorded.ok).toBe(true)
    expect(assets.list(null).ok).toBe(true)
    expect(assets.remove('asset-1', viewer).ok).toBe(false)
    expect(assets.remove('asset-1', admin).ok).toBe(true)

    analytics.recordPageView('docs/private')
    expect(analytics.summary(viewer).ok).toBe(false)
    const summary = analytics.summary(admin)
    expect(summary.ok).toBe(true)
    if (summary.ok) expect(summary.value.totalViews).toBe(1)
  })

  test('delete removes from search', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    pages.create({ path: 'gone', title: 'Gone', content: 'ephemeral mango' }, admin)
    expect(search.search('mango').hits.length).toBe(1)
    pages.remove('gone', admin)
    expect(search.search('mango').hits.length).toBe(0)
    expect(pages.getByPath('gone').ok).toBe(false)
    expect(pages.trash()).toContainEqual(expect.objectContaining({ path: 'gone', lifecycle: 'deleted' }))
  })

  test('archive, restore, and purge control recoverable page lifecycle', () => {
    const db = createDb(':memory:')
    const { pages, search, comments, analytics } = createServices(db)
    pages.create({ path: 'docs/archive-me', title: 'Archive me', content: 'durable kiwi' }, admin)
    comments.create('docs/archive-me', 'sensitive note', admin)
    analytics.recordPageView('docs/archive-me')

    const archived = pages.archive('docs/archive-me', admin)
    expect(archived.ok).toBe(true)
    expect(pages.list().some((page) => page.path === 'docs/archive-me')).toBe(false)
    expect(pages.trash()).toContainEqual(expect.objectContaining({ path: 'docs/archive-me', lifecycle: 'archived' }))
    expect(search.search('kiwi').hits.length).toBe(0)

    const restored = pages.restore('docs/archive-me', admin)
    expect(restored.ok).toBe(true)
    expect(pages.getByPath('docs/archive-me').ok).toBe(true)
    expect(search.search('kiwi').hits.length).toBe(1)

    const purged = pages.purge('docs/archive-me', admin)
    expect(purged.ok).toBe(true)
    expect(pages.history('docs/archive-me').ok).toBe(false)
    expect(tableCount(db, 'page_revisions')).toBe(0)
    expect(tableCount(db, 'page_comments')).toBe(0)
    expect(tableCount(db, 'page_analytics')).toBe(0)
  })
})
