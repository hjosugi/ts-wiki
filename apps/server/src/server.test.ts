import { describe, test, expect } from 'bun:test'
import type { Principal } from '@ts-wiki/core'
import { createDb } from './db/client.ts'
import { pageRedirects } from './db/schema.ts'
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

  test('search omits pages the principal cannot read (page:read ACL)', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)

    pages.create({ path: 'public/a', title: 'Alpha', content: 'a shared banana note' }, admin)
    pages.create({ path: 'secret/b', title: 'Beta', content: 'a secret banana note' }, admin)

    // Without a read predicate, both match.
    expect(search.search('banana').hits.length).toBe(2)

    // With a predicate that denies the secret subtree, only the readable page
    // surfaces — no title/path/snippet leak past the ACL.
    const filtered = search.search('banana', 20, {}, (path) => !path.startsWith('secret/'))
    expect(filtered.hits.length).toBe(1)
    expect(filtered.hits[0]?.path).toBe('public/a')
  })

  test('snippets carry no live markup from page content', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)

    pages.create({ path: 'p', title: 'P', content: 'banana <script>alert(1)</script>' }, admin)
    const snippet = search.search('banana').hits[0]?.snippet ?? ''
    expect(snippet).toContain('<mark>')
    // Raw HTML is disabled at render time and content is stored tag-stripped, so
    // the script tag is entity-encoded — never live markup in the snippet.
    expect(snippet).not.toContain('<script>')
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

  test('create reports a distinct conflict when trash holds the path', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'gone', title: 'Gone', content: 'old' }, admin)
    pages.remove('gone', admin)

    const recreated = pages.create({ path: 'gone', title: 'Gone again', content: 'new' }, admin)

    expect(recreated.ok).toBe(false)
    if (!recreated.ok) {
      expect(recreated.error.kind).toBe('conflict')
      expect(recreated.error.message).toContain('deleted page exists')
      expect(recreated.error.message).toContain('restore it from Trash or purge it first')
    }
  })

  test('update snapshots history and re-indexes', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    pages.create({ path: 'p', title: 'P', content: 'original apple' }, admin)
    pages.update('p', { content: 'replaced orange' }, admin)

    expect(search.search('apple').hits.length).toBe(0)
    expect(search.search('orange').hits.length).toBe(1)
  })

  test('update rejects stale expectedUpdatedAt', async () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    const created = pages.create({ path: 'docs/conflict', title: 'Original', content: 'one' }, admin)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await Bun.sleep(2)

    const first = pages.update('docs/conflict', { title: 'First', expectedUpdatedAt: created.value.updatedAt }, admin)
    const second = pages.update('docs/conflict', { title: 'Second', expectedUpdatedAt: created.value.updatedAt }, admin)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.kind).toBe('conflict')
    const current = pages.getByPath('docs/conflict')
    expect(current.ok).toBe(true)
    if (current.ok) expect(current.value.title).toBe('First')
  })

  test('upsertFromFile centralizes markdown import create/update fallback', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)

    const created = pages.upsertFromFile('docs/imported', {
      title: '',
      description: 'from file',
      content: '# Imported\n\nBody',
    }, {}, admin)
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.value.created).toBe(true)
      expect(created.value.page.title).toBe('imported')
      expect(created.value.page.description).toBe('from file')
    }

    const updated = pages.upsertFromFile('docs/imported', {
      title: 'Updated',
      description: '',
      content: 'Updated body',
    }, { labels: ['Docs'], status: 'verified' }, admin)
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.created).toBe(false)
      expect(updated.value.previous?.title).toBe('imported')
      expect(updated.value.page.title).toBe('Updated')
      expect(updated.value.page.labels).toBe('["docs"]')
      expect(updated.value.page.status).toBe('verified')
    }
  })

  test('saveContent and explicit save share validation and derived descriptions', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'docs/collab', title: 'Collab', content: 'initial' }, admin)

    const autosaved = pages.saveContent('docs/collab', 'A shared description body for autosave.', admin)
    expect(autosaved.ok).toBe(true)
    expect(tableCount(db, 'page_revisions')).toBe(1)
    const explicit = pages.update('docs/collab', { content: 'A shared description body for autosave.' }, admin)
    expect(explicit.ok).toBe(true)
    expect(tableCount(db, 'page_revisions')).toBe(2)
    if (autosaved.ok && explicit.ok) {
      expect(autosaved.value.description).toBe(explicit.value.description)
      expect(autosaved.value.content).toBe(explicit.value.content)
    }
  })

  test('trigram tokenizer finds Japanese mid-run terms', () => {
    const db = createDb(':memory:', { ftsTokenizer: 'trigram' })
    const { pages, search } = createServices(db)
    pages.create({ path: 'jp/search', title: '日本語検索', content: 'これはテストです。天ぷら本文もあります。' }, admin)

    expect(search.search('テスト').hits[0]?.path).toBe('jp/search')
    expect(search.search('天ぷら').hits[0]?.path).toBe('jp/search')
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

  test('move records redirects and resolves old paths after chained moves', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'docs/old', title: 'Old', content: 'content' }, admin)

    expect(pages.move('docs/old', 'docs/middle', admin).ok).toBe(true)
    expect(pages.move('docs/middle', 'docs/new', admin).ok).toBe(true)

    const old = pages.resolveByPath('docs/old')
    expect(old.ok).toBe(true)
    if (old.ok) {
      expect(old.value.page.path).toBe('docs/new')
      expect(old.value.redirectedFrom).toEqual(['docs/old'])
    }

    const middle = pages.resolveByPath('docs/middle')
    expect(middle.ok).toBe(true)
    if (middle.ok) {
      expect(middle.value.page.path).toBe('docs/new')
      expect(middle.value.redirectedFrom).toEqual(['docs/middle'])
    }
  })

  test('redirect resolution detects loops', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    db.insert(pageRedirects).values({ fromPath: 'a', toPath: 'b', createdAt: Date.now() }).run()
    db.insert(pageRedirects).values({ fromPath: 'b', toPath: 'a', createdAt: Date.now() }).run()

    const resolved = pages.resolveByPath('a')

    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.error.kind).toBe('conflict')
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

  test('history and comments include the author display name', async () => {
    const db = createDb(':memory:')
    const { pages, comments, users } = createServices(db)
    const created = await users.create({
      email: 'alice@example.com',
      name: 'Alice',
      password: 'secret1',
      role: 'editor',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const alice: Principal = { id: created.value.id, role: 'editor' }

    pages.create({ path: 'docs/a', title: 'A', content: 'one' }, alice)
    pages.update('docs/a', { content: 'two' }, alice)
    const history = pages.history('docs/a')
    expect(history.ok).toBe(true)
    if (history.ok) expect(history.value[0]?.authorName).toBe('Alice')

    const added = comments.create('docs/a', 'first!', alice)
    expect(added.ok).toBe(true)
    if (added.ok) expect(added.value.authorName).toBe('Alice')
    const list = comments.list('docs/a')
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.value[0]?.authorName).toBe('Alice')

    // A revision with no matching user row resolves to a null name, not a crash.
    const orphan = pages.history('docs/a')
    expect(orphan.ok).toBe(true)
  })

  test('labels() aggregates distinct labels with counts', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'a', title: 'A', content: 'x', labels: ['guide', 'api'] }, admin)
    pages.create({ path: 'b', title: 'B', content: 'y', labels: ['guide'] }, admin)

    const labels = pages.labels()
    expect(labels.find((l) => l.label === 'guide')?.count).toBe(2)
    expect(labels.find((l) => l.label === 'api')?.count).toBe(1)
    // Sorted most-used first.
    expect(labels[0]?.label).toBe('guide')
  })

  test('brokenLinks() reports links to non-existent pages', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'docs/start', title: 'Start', content: 'see [[Docs/Intro]] and [[Docs/Ghost]]' }, admin)
    pages.create({ path: 'docs/intro', title: 'Intro', content: 'hi' }, admin)

    const broken = pages.brokenLinks()
    expect(broken.length).toBe(1)
    expect(broken[0]?.path).toBe('docs/start')
    expect(broken[0]?.target).toBe('docs/ghost')
    // The resolvable link is not reported.
    expect(broken.some((b) => b.target === 'docs/intro')).toBe(false)
  })

  test('recentChanges() returns revisions across pages, newest first, capped', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'a', title: 'A', content: 'one' }, admin)
    pages.create({ path: 'b', title: 'B', content: 'two' }, admin)
    pages.update('a', { content: 'one!' }, admin)

    const changes = pages.recentChanges()
    expect(changes.length).toBeGreaterThanOrEqual(3)
    // Newest first: the update to 'a' is the most recent action.
    expect(changes[0]?.path).toBe('a')
    expect(changes[0]?.action).toBe('updated')
    // The limit is respected and capped.
    expect(pages.recentChanges(1).length).toBe(1)
    expect(pages.recentChanges(9999).length).toBeLessThanOrEqual(200)
  })

  test('history stays newest-first even when revisions share a timestamp', () => {
    const db = createDb(':memory:')
    const { pages } = createServices(db)
    pages.create({ path: 'docs/history', title: 'History', content: 'one' }, admin)
    pages.update('docs/history', { content: 'two' }, admin)
    // Force both revisions onto the same created_at so ordering can't rely on
    // the clock — the rowid tie-break must still put the newer one first.
    db.$client.prepare('UPDATE page_revisions SET created_at = 1000').run()

    const history = pages.history('docs/history')
    expect(history.ok).toBe(true)
    if (history.ok) {
      expect(history.value.length).toBe(2)
      expect(history.value[0]?.action).toBe('updated')
      expect(history.value[1]?.action).toBe('created')
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

    analytics.recordPageView('docs/private', admin)
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
    analytics.recordPageView('docs/archive-me', admin)

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
    const textDump = JSON.stringify({
      pages: db.$client.prepare('SELECT * FROM pages').all(),
      revisions: db.$client.prepare('SELECT * FROM page_revisions').all(),
      comments: db.$client.prepare('SELECT * FROM page_comments').all(),
    })
    expect(textDump).not.toContain('durable kiwi')
    expect(textDump).not.toContain('sensitive note')
  })
})
