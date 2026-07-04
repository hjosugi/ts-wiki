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
import { eq, ne, asc, desc, sql } from 'drizzle-orm'
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
  rewritePageLinks,
  extractCalendarEvents,
  normalizePath,
  normalizeLabels,
  isPageStatus,
  normalizeLocale,
  type PageStatus,
  type PageFileData,
  type ExtractedCalendarEvent,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { pageAnalytics, pageComments, pageRedirects, pages, pageRevisions, type Page, type PageRevision } from '../db/schema.ts'

export interface PageSummary {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly lifecycle: Page['lifecycle']
  readonly status: Page['status']
  readonly labels: string
  readonly ownerId: string | null
  readonly reviewAt: number | null
  readonly spaceKey: string
  readonly locale: string
  readonly updatedAt: number
}

export interface PageSpace {
  readonly key: string
  readonly pages: number
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

export interface ResolvedPage {
  readonly page: Page
  readonly redirectedFrom: readonly string[]
}

export interface UpdatePagePatch {
  readonly title?: string
  readonly content?: string
  readonly description?: string
  readonly labels?: readonly string[]
  readonly status?: PageStatus
  readonly ownerId?: string | null
  readonly reviewAt?: number | null
  readonly locale?: string | null
  readonly expectedUpdatedAt?: number | null
}

export interface UpsertPageFileOptions {
  readonly title?: string
  readonly description?: string
  readonly labels?: readonly string[]
  readonly status?: PageStatus
  readonly locale?: string | null
}

export interface UpsertPageFileResult {
  readonly page: Page
  readonly created: boolean
  readonly previous?: Page
}

export interface PageService {
  list(): PageSummary[]
  trash(): PageSummary[]
  spaces(): PageSpace[]
  graph(): PageGraph
  backlinks(path: string): PageBacklink[]
  events(): ExtractedCalendarEvent[]
  history(path: string): Result<PageRevisionSummary[], AppError>
  getByPath(path: string): Result<Page, AppError>
  resolveByPath(path: string): Result<ResolvedPage, AppError>
  create(input: PageInput, principal: Principal | null): Result<Page, AppError>
  update(path: string, patch: UpdatePagePatch, principal: Principal | null): Result<Page, AppError>
  upsertFromFile(
    path: string,
    file: PageFileData,
    options: UpsertPageFileOptions,
    principal: Principal | null,
  ): Result<UpsertPageFileResult, AppError>
  /** Lightweight content save (no revision) — used by collaborative autosave. */
  saveContent(
    path: string,
    content: string,
    principal: Principal | null,
    expectedUpdatedAt?: number | null,
  ): Result<Page, AppError>
  restoreRevision(path: string, revisionId: string, principal: Principal | null): Result<Page, AppError>
  archive(path: string, principal: Principal | null): Result<Page, AppError>
  restore(path: string, principal: Principal | null): Result<Page, AppError>
  move(oldPath: string, newPath: string, principal: Principal | null): Result<Page, AppError>
  remove(path: string, principal: Principal | null): Result<{ path: string }, AppError>
  purge(path: string, principal: Principal | null): Result<{ path: string }, AppError>
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
    db.select().from(pages).where(eq(pages.path, normalizePath(path))).get()

  const findById = (id: string): Page =>
    db.select().from(pages).where(eq(pages.id, id)).get()!

  const findRedirect = (path: string): string | null =>
    db.select().from(pageRedirects).where(eq(pageRedirects.fromPath, normalizePath(path))).get()?.toPath ?? null

  const resolvePath = (path: string): Result<ResolvedPage, AppError> => {
    let currentPath = normalizePath(path)
    const redirectedFrom: string[] = []
    const seen = new Set<string>()

    for (let hop = 0; hop < 10; hop += 1) {
      if (seen.has(currentPath)) return err(conflict(`Redirect loop detected for "${path}"`))
      seen.add(currentPath)
      const page = findByPath(currentPath)
      if (page?.lifecycle === 'active') return ok({ page, redirectedFrom })

      const nextPath = findRedirect(currentPath)
      if (!nextPath) return err(notFound(`No page at "${path}"`))
      redirectedFrom.push(currentPath)
      currentPath = normalizePath(nextPath)
    }

    return err(conflict(`Redirect chain is too long for "${path}"`))
  }

  const tombstoneConflict = (path: string): AppError =>
    conflict(`A deleted page exists here at "${normalizePath(path)}"; restore it from Trash or purge it first.`)

  const pathConflict = (page: Page, path: string): AppError =>
    page.lifecycle === 'active' ? conflict(`A page already exists at "${normalizePath(path)}"`) : tombstoneConflict(path)

  const snapshotRevision = (
    tx: { insert: DB['insert'] },
    page: Pick<Page, 'id' | 'path' | 'title' | 'description' | 'content'>,
    principal: Principal | null,
    action: PageRevision['action'],
    now: number,
  ): void => {
    tx.insert(pageRevisions)
      .values({
        id: crypto.randomUUID(),
        pageId: page.id,
        path: page.path,
        title: page.title,
        description: page.description,
        content: page.content,
        authorId: principal?.id ?? null,
        action,
        createdAt: now,
      })
      .run()
  }

  const parseLabels = (value: string): string[] => {
    try {
      const labels = JSON.parse(value) as unknown
      return Array.isArray(labels) ? normalizeLabels(labels.filter((label): label is string => typeof label === 'string')) : []
    } catch {
      return []
    }
  }

  const writeExistingPage = (
    current: Page,
    next: {
      title: string
      description: string
      content: string
      labels: readonly string[]
      status: PageStatus
      ownerId: string | null
      reviewAt: number | null
      locale: string
    },
    principal: Principal | null,
    revisionAction: 'updated' | null,
  ): Page => {
    const { html, toc } = renderMarkdown(next.content)
    const now = Date.now()

    return db.transaction((tx) => {
      if (revisionAction) {
        // Snapshot the pre-update state into history. Collaborative autosave
        // uses the same write path but passes null to avoid revision spam.
        snapshotRevision(tx, current, principal, revisionAction, now)
      }

      tx.update(pages)
        .set({
          title: next.title,
          description: next.description,
          content: next.content,
          renderedHtml: html,
          toc: JSON.stringify(toc),
          labels: JSON.stringify(next.labels),
          status: next.status,
          ownerId: next.ownerId,
          reviewAt: next.reviewAt,
          locale: next.locale,
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
          lifecycle: pages.lifecycle,
          status: pages.status,
          labels: pages.labels,
          ownerId: pages.ownerId,
          reviewAt: pages.reviewAt,
          spaceKey: pages.spaceKey,
          locale: pages.locale,
          updatedAt: pages.updatedAt,
        })
        .from(pages)
        .where(eq(pages.lifecycle, 'active'))
        .orderBy(asc(pages.path))
        .all()
    },

    trash() {
      return db
        .select({
          path: pages.path,
          title: pages.title,
          description: pages.description,
          lifecycle: pages.lifecycle,
          status: pages.status,
          labels: pages.labels,
          ownerId: pages.ownerId,
          reviewAt: pages.reviewAt,
          spaceKey: pages.spaceKey,
          locale: pages.locale,
          updatedAt: pages.updatedAt,
        })
        .from(pages)
        .where(ne(pages.lifecycle, 'active'))
        .orderBy(desc(pages.updatedAt))
        .all()
    },

    spaces() {
      return db
        .select({
          key: pages.spaceKey,
          pages: sql<number>`count(*)`,
          updatedAt: sql<number>`max(${pages.updatedAt})`,
        })
        .from(pages)
        .where(eq(pages.lifecycle, 'active'))
        .groupBy(pages.spaceKey)
        .orderBy(asc(pages.spaceKey))
        .all()
    },

    graph() {
      const allPages = db.select().from(pages).where(eq(pages.lifecycle, 'active')).orderBy(asc(pages.path)).all()
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
      for (const page of db.select().from(pages).where(eq(pages.lifecycle, 'active')).orderBy(asc(pages.path)).all()) {
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
        .where(eq(pages.lifecycle, 'active'))
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
      if (page?.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      return ok(page)
    },

    resolveByPath(path) {
      return resolvePath(path)
    },

    create(input, principal) {
      const validated = validatePageInput(input)
      if (!validated.ok) return validated
      const v = validated.value
      if (!can(principal, 'page:create', { path: v.path })) return err(forbidden())

      const existing = findByPath(v.path)
      if (existing) return err(pathConflict(existing, v.path))

      const { html, toc } = renderMarkdown(v.content)
      const now = Date.now()
      const id = crypto.randomUUID()

      const page = db.transaction((tx) => {
        tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, v.path)).run()
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
            lifecycle: 'active',
            labels: JSON.stringify(v.labels),
            status: v.status,
            ownerId: v.ownerId,
            reviewAt: v.reviewAt,
            spaceKey: v.path.split('/')[0] || 'main',
            locale: v.locale,
            authorId: principal?.id ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .run()

        snapshotRevision(tx, { id, path: v.path, title: v.title, description: v.description, content: v.content }, principal, 'created', now)

        reindex(id, v.title, v.description, v.content)
        return findById(id)
      })

      return ok(page)
    },

    update(path, patch, principal) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      if (!can(principal, 'page:update', { path: current.path })) return err(forbidden())
      if (patch.expectedUpdatedAt != null && current.updatedAt !== patch.expectedUpdatedAt) {
        return err(conflict(`Page "${path}" changed since you opened it; reload the latest version before saving.`))
      }

      const validated = validatePageInput({
        path: current.path,
        title: patch.title ?? current.title,
        content: patch.content ?? current.content,
        // Leave undefined when not supplied so the summary is re-derived from
        // the new content rather than carrying a stale auto-description forward.
        description: patch.description,
        labels: patch.labels ?? parseLabels(current.labels),
        status: patch.status ?? current.status,
        ownerId: patch.ownerId === undefined ? current.ownerId : patch.ownerId,
        reviewAt: patch.reviewAt === undefined ? current.reviewAt : patch.reviewAt,
        locale: patch.locale ?? current.locale,
      })
      if (!validated.ok) return validated
      const v = validated.value

      const page = writeExistingPage(current, v, principal, 'updated')

      return ok(page)
    },

    upsertFromFile(path, file, options, principal) {
      const title = (options.title ?? file.title).trim() || normalizePath(path).split('/').at(-1) || 'Imported page'
      const description = options.description ?? file.description
      const existing = this.getByPath(path)
      if (existing.ok) {
        const page = this.update(path, {
          title,
          description,
          content: file.content,
          labels: options.labels,
          status: options.status,
          locale: options.locale,
        }, principal)
        if (!page.ok) return page
        return ok({ page: page.value, created: false, previous: existing.value })
      }

      const page = this.create({
        path,
        title,
        description,
        content: file.content,
        labels: options.labels,
        status: options.status,
        locale: options.locale,
      }, principal)
      if (!page.ok) return page
      return ok({ page: page.value, created: true })
    },

    saveContent(path, content, principal, expectedUpdatedAt = null) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      if (!can(principal, 'page:update', { path: current.path })) return err(forbidden())
      if (expectedUpdatedAt !== null && current.updatedAt !== expectedUpdatedAt) {
        return err(conflict(`Page "${path}" changed outside the collaborative editor`))
      }

      const validated = validatePageInput({
        path: current.path,
        title: current.title,
        content,
        labels: parseLabels(current.labels),
        status: isPageStatus(current.status) ? current.status : 'draft',
        ownerId: current.ownerId,
        reviewAt: current.reviewAt,
        locale: current.locale,
      })
      if (!validated.ok) return validated

      // Lightweight save for collaborative autosave: refresh content + render +
      // search index WITHOUT snapshotting a revision (explicit Save does that).
      const page = writeExistingPage(
        current,
        validated.value,
        principal,
        null,
      )
      return ok(page)
    },

    restoreRevision(path, revisionId, principal) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      if (!can(principal, 'page:update', { path: current.path })) return err(forbidden())
      const revision = db.select().from(pageRevisions).where(eq(pageRevisions.id, revisionId)).get()
      if (!revision || revision.pageId !== current.id) return err(notFound('Revision not found'))

      const page = writeExistingPage(
        current,
        {
          title: revision.title,
          description: revision.description,
          content: revision.content,
          labels: parseLabels(current.labels),
          status: isPageStatus(current.status) ? current.status : 'draft',
          ownerId: current.ownerId,
          reviewAt: current.reviewAt,
          locale: normalizeLocale(current.locale),
        },
        principal,
        'updated',
      )
      return ok(page)
    },

    archive(path, principal) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      if (!can(principal, 'page:delete', { path: current.path })) return err(forbidden())
      const now = Date.now()
      const page = db.transaction((tx) => {
        snapshotRevision(tx, current, principal, 'archived', now)
        tx.update(pages)
          .set({ lifecycle: 'archived', updatedAt: now })
          .where(eq(pages.id, current.id))
          .run()
        ftsDelete.run(current.id)
        return findById(current.id)
      })
      return ok(page)
    },

    restore(path, principal) {
      const current = findByPath(path)
      if (!current) return err(notFound(`No page at "${path}"`))
      if (!can(principal, 'page:update', { path: current.path })) return err(forbidden())
      if (current.lifecycle === 'active') return ok(current)
      const now = Date.now()
      const page = db.transaction((tx) => {
        snapshotRevision(tx, current, principal, 'restored', now)
        tx.update(pages)
          .set({ lifecycle: 'active', updatedAt: now })
          .where(eq(pages.id, current.id))
          .run()
        reindex(current.id, current.title, current.description, current.content)
        return findById(current.id)
      })
      return ok(page)
    },

    move(oldPath, newPath, principal) {
      const current = findByPath(oldPath)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${oldPath}"`))
      if (!can(principal, 'page:move', { path: current.path })) return err(forbidden())

      const validated = validatePageInput({
        path: newPath,
        title: current.title,
        content: current.content,
        description: current.description,
        labels: parseLabels(current.labels),
        status: isPageStatus(current.status) ? current.status : 'draft',
        ownerId: current.ownerId,
        reviewAt: current.reviewAt,
        locale: current.locale,
      })
      if (!validated.ok) return validated
      const v = validated.value

      if (v.path === current.path) return ok(current)
      const existing = findByPath(v.path)
      if (existing) return err(pathConflict(existing, v.path))

      const now = Date.now()
      const page = db.transaction((tx) => {
        snapshotRevision(tx, current, principal, 'moved', now)

        tx.update(pages)
          .set({
            path: v.path,
            spaceKey: v.path.split('/')[0] || 'main',
            updatedAt: now,
          })
          .where(eq(pages.id, current.id))
          .run()
        tx.update(pageComments)
          .set({ path: v.path, updatedAt: now })
          .where(eq(pageComments.pageId, current.id))
          .run()
        tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, v.path)).run()
        tx.update(pageRedirects)
          .set({ toPath: v.path })
          .where(eq(pageRedirects.toPath, current.path))
          .run()
        tx.insert(pageRedirects)
          .values({ fromPath: current.path, toPath: v.path, createdAt: now })
          .onConflictDoUpdate({
            target: pageRedirects.fromPath,
            set: { toPath: v.path, createdAt: now },
          })
          .run()

        for (const page of tx.select().from(pages).where(eq(pages.lifecycle, 'active')).all()) {
          const content = rewritePageLinks(page.content, current.path, v.path)
          if (content === page.content) continue
          const { html, toc } = renderMarkdown(content)
          snapshotRevision(tx, page, principal, 'updated', now)
          tx.update(pages)
            .set({
              content,
              renderedHtml: html,
              toc: JSON.stringify(toc),
              updatedAt: now,
            })
            .where(eq(pages.id, page.id))
            .run()
          reindex(page.id, page.title, page.description, content)
        }

        reindex(current.id, current.title, current.description, current.content)
        return findById(current.id)
      })

      return ok(page)
    },

    remove(path, principal) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      if (!can(principal, 'page:delete', { path: current.path })) return err(forbidden())

      const now = Date.now()
      const deleted = db.transaction((tx) => {
        snapshotRevision(tx, current, principal, 'deleted', now)

        tx.update(pages)
          .set({ lifecycle: 'deleted', updatedAt: now })
          .where(eq(pages.id, current.id))
          .run()
        tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, current.path)).run()
        tx.delete(pageRedirects).where(eq(pageRedirects.toPath, current.path)).run()
        ftsDelete.run(current.id)
        return findById(current.id)
      })

      return ok({ path: deleted.path })
    },

    purge(path, principal) {
      if (!can(principal, 'admin:access')) return err(forbidden())

      const current = findByPath(path)
      if (!current) return err(notFound(`No page at "${path}"`))
      db.transaction((tx) => {
        const paths = new Set<string>([current.path])
        for (const row of tx.select({ path: pageRevisions.path }).from(pageRevisions).where(eq(pageRevisions.pageId, current.id)).all()) {
          paths.add(row.path)
        }
        for (const row of tx.select({ path: pageComments.path }).from(pageComments).where(eq(pageComments.pageId, current.id)).all()) {
          paths.add(row.path)
        }
        for (const pagePath of paths) {
          tx.delete(pageAnalytics).where(eq(pageAnalytics.path, pagePath)).run()
          tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, pagePath)).run()
          tx.delete(pageRedirects).where(eq(pageRedirects.toPath, pagePath)).run()
        }
        tx.delete(pageComments).where(eq(pageComments.pageId, current.id)).run()
        tx.delete(pageRevisions).where(eq(pageRevisions.pageId, current.id)).run()
        tx.delete(pages).where(eq(pages.id, current.id)).run()
        ftsDelete.run(current.id)
      })
      return ok({ path: current.path })
    },
  }
}
