/**
 * Page service — the core write path. Every mutation:
 *   1. checks permission (pure `can()` from @ts-wiki/core),
 *   2. validates & normalises input (pure `validatePageInput`),
 *   3. renders Markdown → HTML + TOC (pure `renderMarkdown`),
 *   4. persists page + revision + FTS index in ONE transaction.
 *
 * Contrast Wiki.js: render is fire-and-forget there, so fresh pages flash blank
 * and aren't searchable; storage writes aren't transactional. Here a save is
 * atomic and the page is fully rendered and indexed the instant it returns.
 */
import { eq, asc, desc } from 'drizzle-orm'
import {
  type Result,
  ok,
  err,
  type AppError,
  type Principal,
  type PageInput,
  can,
  forbidden,
  notFound,
  conflict,
  validatePageInput,
  renderMarkdown,
  toPlainText,
  extractPageLinks,
  extractCalendarEvents,
  normalizePath,
  type ExtractedCalendarEvent,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { pages, pageRevisions, type Page, type PageRevision } from '../db/schema.ts'

export interface PageSummary {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly updatedAt: number
}

export interface PageGraphNode {
  readonly path: string
  readonly title: string
  readonly kind: 'page' | 'missing'
}

export interface PageGraphEdge {
  readonly source: string
  readonly target: string
  readonly kind: 'wikilink' | 'markdown'
}

export interface PageGraph {
  readonly nodes: PageGraphNode[]
  readonly edges: PageGraphEdge[]
}

export interface PageBacklink {
  readonly path: string
  readonly title: string
  readonly label: string
  readonly kind: 'wikilink' | 'markdown'
}

export interface PageRevisionSummary {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly description: string
  readonly content: string
  readonly authorId: string | null
  readonly action: PageRevision['action']
  readonly createdAt: number
}

export interface UpdatePagePatch {
  readonly title?: string
  readonly content?: string
  readonly description?: string
}

export interface PageService {
  list(): PageSummary[]
  graph(): PageGraph
  backlinks(path: string): PageBacklink[]
  events(): ExtractedCalendarEvent[]
  history(path: string): Result<PageRevisionSummary[], AppError>
  getByPath(path: string): Result<Page, AppError>
  create(input: PageInput, principal: Principal | null): Result<Page, AppError>
  update(path: string, patch: UpdatePagePatch, principal: Principal | null): Result<Page, AppError>
  /** Lightweight content save (no revision) — used by collaborative autosave. */
  saveContent(
    path: string,
    content: string,
    principal: Principal | null,
    expectedUpdatedAt?: number | null,
  ): Result<Page, AppError>
  move(oldPath: string, newPath: string, principal: Principal | null): Result<Page, AppError>
  remove(path: string, principal: Principal | null): Result<{ path: string }, AppError>
}

export const createPageService = (db: DB): PageService => {
  // Prepared FTS5 statements (FTS5 has no UPSERT, so update = delete + insert).
  const ftsInsert = db.$client.prepare(
    'INSERT INTO pages_fts(page_id, title, description, content) VALUES (?, ?, ?, ?)',
  )
  const ftsDelete = db.$client.prepare('DELETE FROM pages_fts WHERE page_id = ?')

  const reindex = (id: string, title: string, description: string, content: string): void => {
    ftsDelete.run(id)
    ftsInsert.run(id, title, description, toPlainText(content))
  }

  const findByPath = (path: string): Page | undefined =>
    db.select().from(pages).where(eq(pages.path, path)).get()

  const findById = (id: string): Page =>
    db.select().from(pages).where(eq(pages.id, id)).get()!

  const writeExistingPage = (
    current: Page,
    next: { title: string; description: string; content: string },
    principal: Principal | null,
    revisionAction: 'updated' | null,
  ): Page => {
    const { html, toc } = renderMarkdown(next.content)
    const now = Date.now()

    return db.transaction((tx) => {
      if (revisionAction) {
        // Snapshot the pre-update state into history. Collaborative autosave
        // uses the same write path but passes null to avoid revision spam.
        tx.insert(pageRevisions)
          .values({
            id: crypto.randomUUID(),
            pageId: current.id,
            path: current.path,
            title: current.title,
            description: current.description,
            content: current.content,
            authorId: principal?.id ?? null,
            action: revisionAction,
            createdAt: now,
          })
          .run()
      }

      tx.update(pages)
        .set({
          title: next.title,
          description: next.description,
          content: next.content,
          renderedHtml: html,
          toc: JSON.stringify(toc),
          updatedAt: now,
        })
        .where(eq(pages.id, current.id))
        .run()

      reindex(current.id, next.title, next.description, next.content)
      return findById(current.id)
    })
  }

  return {
    list() {
      return db
        .select({
          path: pages.path,
          title: pages.title,
          description: pages.description,
          updatedAt: pages.updatedAt,
        })
        .from(pages)
        .orderBy(asc(pages.path))
        .all()
    },

    graph() {
      const allPages = db.select().from(pages).orderBy(asc(pages.path)).all()
      const existing = new Map(allPages.map((page) => [page.path, page]))
      const missing = new Set<string>()
      const edgeKeys = new Set<string>()
      const edges: PageGraphEdge[] = []

      for (const page of allPages) {
        for (const link of extractPageLinks(page.content)) {
          if (link.path === page.path) continue
          if (!existing.has(link.path)) missing.add(link.path)
          const key = `${page.path}\u0000${link.path}\u0000${link.kind}`
          if (edgeKeys.has(key)) continue
          edgeKeys.add(key)
          edges.push({ source: page.path, target: link.path, kind: link.kind })
        }
      }

      const nodes: PageGraphNode[] = [
        ...allPages.map((page) => ({ path: page.path, title: page.title, kind: 'page' as const })),
        ...[...missing]
          .sort()
          .map((path) => ({ path, title: path.split('/').at(-1) ?? path, kind: 'missing' as const })),
      ]

      return { nodes, edges }
    },

    backlinks(path) {
      const target = normalizePath(path)
      const out: PageBacklink[] = []
      const seen = new Set<string>()
      for (const page of db.select().from(pages).orderBy(asc(pages.path)).all()) {
        for (const link of extractPageLinks(page.content)) {
          if (link.path !== target) continue
          const key = `${page.path}\u0000${link.kind}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ path: page.path, title: page.title, label: link.label, kind: link.kind })
        }
      }
      return out
    },

    events() {
      return db
        .select({
          path: pages.path,
          content: pages.content,
        })
        .from(pages)
        .orderBy(asc(pages.path))
        .all()
        .flatMap((page) => extractCalendarEvents(page.content, page.path))
        .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    },

    history(path) {
      const page = findByPath(path)
      if (!page) return err(notFound(`No page at "${path}"`))
      const revisions = db
        .select({
          id: pageRevisions.id,
          path: pageRevisions.path,
          title: pageRevisions.title,
          description: pageRevisions.description,
          content: pageRevisions.content,
          authorId: pageRevisions.authorId,
          action: pageRevisions.action,
          createdAt: pageRevisions.createdAt,
        })
        .from(pageRevisions)
        .where(eq(pageRevisions.pageId, page.id))
        .orderBy(desc(pageRevisions.createdAt))
        .all()
      return ok(revisions)
    },

    getByPath(path) {
      const page = findByPath(path)
      return page ? ok(page) : err(notFound(`No page at "${path}"`))
    },

    create(input, principal) {
      if (!can(principal, 'page:write')) return err(forbidden())

      const validated = validatePageInput(input)
      if (!validated.ok) return validated
      const v = validated.value

      if (findByPath(v.path)) return err(conflict(`A page already exists at "${v.path}"`))

      const { html, toc } = renderMarkdown(v.content)
      const now = Date.now()
      const id = crypto.randomUUID()

      const page = db.transaction((tx) => {
        tx.insert(pages)
          .values({
            id,
            path: v.path,
            title: v.title,
            description: v.description,
            content: v.content,
            renderedHtml: html,
            toc: JSON.stringify(toc),
            contentType: 'markdown',
            authorId: principal?.id ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .run()

        tx.insert(pageRevisions)
          .values({
            id: crypto.randomUUID(),
            pageId: id,
            path: v.path,
            title: v.title,
            description: v.description,
            content: v.content,
            authorId: principal?.id ?? null,
            action: 'created',
            createdAt: now,
          })
          .run()

        reindex(id, v.title, v.description, v.content)
        return findById(id)
      })

      return ok(page)
    },

    update(path, patch, principal) {
      if (!can(principal, 'page:write')) return err(forbidden())

      const current = findByPath(path)
      if (!current) return err(notFound(`No page at "${path}"`))

      const validated = validatePageInput({
        path: current.path,
        title: patch.title ?? current.title,
        content: patch.content ?? current.content,
        // Leave undefined when not supplied so the summary is re-derived from
        // the new content rather than carrying a stale auto-description forward.
        description: patch.description,
      })
      if (!validated.ok) return validated
      const v = validated.value

      const page = writeExistingPage(current, v, principal, 'updated')

      return ok(page)
    },

    saveContent(path, content, principal, expectedUpdatedAt = null) {
      if (!can(principal, 'page:write')) return err(forbidden())

      const current = findByPath(path)
      if (!current) return err(notFound(`No page at "${path}"`))
      if (expectedUpdatedAt !== null && current.updatedAt !== expectedUpdatedAt) {
        return err(conflict(`Page "${path}" changed outside the collaborative editor`))
      }

      // Lightweight save for collaborative autosave: refresh content + render +
      // search index WITHOUT snapshotting a revision (explicit Save does that).
      const description = toPlainText(content).slice(0, 200)
      const page = writeExistingPage(current, { title: current.title, description, content }, principal, null)
      return ok(page)
    },

    move(oldPath, newPath, principal) {
      if (!can(principal, 'page:write')) return err(forbidden())

      const current = findByPath(oldPath)
      if (!current) return err(notFound(`No page at "${oldPath}"`))

      const validated = validatePageInput({
        path: newPath,
        title: current.title,
        content: current.content,
        description: current.description,
      })
      if (!validated.ok) return validated
      const v = validated.value

      if (v.path === current.path) return ok(current)
      if (findByPath(v.path)) return err(conflict(`A page already exists at "${v.path}"`))

      const now = Date.now()
      const page = db.transaction((tx) => {
        tx.insert(pageRevisions)
          .values({
            id: crypto.randomUUID(),
            pageId: current.id,
            path: current.path,
            title: current.title,
            description: current.description,
            content: current.content,
            authorId: principal?.id ?? null,
            action: 'moved',
            createdAt: now,
          })
          .run()

        tx.update(pages)
          .set({
            path: v.path,
            updatedAt: now,
          })
          .where(eq(pages.id, current.id))
          .run()

        reindex(current.id, current.title, current.description, current.content)
        return findById(current.id)
      })

      return ok(page)
    },

    remove(path, principal) {
      if (!can(principal, 'page:delete')) return err(forbidden())

      const current = findByPath(path)
      if (!current) return err(notFound(`No page at "${path}"`))

      const now = Date.now()
      db.transaction((tx) => {
        tx.insert(pageRevisions)
          .values({
            id: crypto.randomUUID(),
            pageId: current.id,
            path: current.path,
            title: current.title,
            description: current.description,
            content: current.content,
            authorId: principal?.id ?? null,
            action: 'deleted',
            createdAt: now,
          })
          .run()

        tx.delete(pages).where(eq(pages.id, current.id)).run()
        ftsDelete.run(current.id)
      })

      return ok({ path })
    },
  }
}
