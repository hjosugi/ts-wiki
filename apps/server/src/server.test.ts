import { describe, test, expect } from 'bun:test'
import type { Principal } from '@ts-wiki/core'
import { createDb } from './db/client.ts'
import { createServices } from './services/index.ts'

const admin: Principal = { id: 'admin-1', role: 'admin' }
const anon = null

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

  test('move changes the page path and preserves search index', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    pages.create({ path: 'old/path', title: 'Movable', content: 'portable pear' }, admin)

    const moved = pages.move('old/path', 'New/Path', admin)

    expect(moved.ok).toBe(true)
    if (moved.ok) expect(moved.value.path).toBe('new/path')
    expect(pages.getByPath('old/path').ok).toBe(false)
    expect(pages.getByPath('new/path').ok).toBe(true)
    expect(search.search('pear').hits[0]?.path).toBe('new/path')
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

  test('delete removes from search', () => {
    const db = createDb(':memory:')
    const { pages, search } = createServices(db)
    pages.create({ path: 'gone', title: 'Gone', content: 'ephemeral mango' }, admin)
    expect(search.search('mango').hits.length).toBe(1)
    pages.remove('gone', admin)
    expect(search.search('mango').hits.length).toBe(0)
  })
})
