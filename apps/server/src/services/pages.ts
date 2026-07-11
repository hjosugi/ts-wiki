/**
 * Page service — the core write path. Every mutation:
 *   1. checks permission (pure `can()` from @kawaii-wiki/core),
 *   2. validates & normalises input (pure `validatePageInput`),
 *   3. renders Markdown → HTML + TOC (pure `renderMarkdown`),
 *   4. persists page + revision + FTS index in ONE transaction.
 *
 * Contrast Wiki.js: render is fire-and-forget there, so fresh pages flash blank
 * and aren't searchable; storage writes aren't transactional. Here a save is
 * atomic and the page is fully rendered and indexed the instant it returns.
 */
import { eq, ne, asc, desc, lt, sql } from 'drizzle-orm'
import {
  type Result,
  ok,
  err,
  type AppError,
  type Principal,
  type PageInput,
  notFound,
  conflict,
  validationError,
  validatePageInput,
  renderMarkdown,
  type RenderResult,
  extractPageLinks,
  rewritePageLinks,
  extractCalendarEvents,
  normalizePath,
  normalizeLabels,
  parseJsonStringArray,
  requirePermission,
  isPageStatus,
  normalizeLocale,
  type PageStatus,
  type PageFileData,
  type ExtractedCalendarEvent,
  contentWithTocFrontmatter,
} from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import { isUniqueConstraintError } from '../db/errors.ts'
import {
  pageAnalytics,
  pageComments,
  pageRedirects,
  pages,
  pageRevisions,
  users,
  type Page,
  type PageRevision,
} from '../db/schema.ts'
import type { SearchIndexer } from './search.ts'

export interface PageSummary {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly icon: string
  readonly coverUrl: string
  readonly coverPosition: string
  readonly lifecycle: Page['lifecycle']
  readonly status: Page['status']
  readonly labels: string
  readonly ownerId: string | null
  readonly authorId: string | null
  readonly reviewAt: number | null
  readonly publishAt: number | null
  readonly navOrder: number | null
  readonly pinned: boolean
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

export interface LabelCount {
  readonly label: string
  readonly count: number
}

export interface BrokenLink {
  readonly path: string
  readonly title: string
  readonly target: string
  readonly label: string
  readonly kind: 'wikilink' | 'markdown'
}

export interface RecentChange {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly action: PageRevision['action']
  readonly authorId: string | null
  readonly authorName: string | null
  readonly createdAt: number
}

export interface PageRedirectView {
  readonly fromPath: string
  readonly toPath: string
  readonly createdAt: number
}

export interface PageRevisionSummary {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly description: string
  readonly content: string
  readonly authorId: string | null
  /** Display name of the author, or null if unknown/deleted. */
  readonly authorName: string | null
  readonly action: PageRevision['action']
  readonly createdAt: number
}

export interface PageInsightContributor {
  readonly authorId: string | null
  readonly authorName: string
  readonly revisions: number
  readonly lastContributionAt: number
}

export interface PageRevisionInsight {
  readonly revisionCount: number
  readonly contributors: PageInsightContributor[]
}

export interface ResolvedPage {
  readonly page: Page
  readonly redirectedFrom: readonly string[]
}

export interface UpdatePagePatch {
  readonly title?: string
  readonly content?: string
  readonly description?: string
  readonly icon?: string
  readonly coverUrl?: string
  readonly coverPosition?: string
  readonly labels?: readonly string[]
  readonly status?: PageStatus
  readonly ownerId?: string | null
  readonly reviewAt?: number | null
  readonly publishAt?: number | null
  readonly locale?: string | null
  readonly navOrder?: number | null
  readonly pinned?: boolean
  readonly expectedUpdatedAt?: number | null
}

export interface UpsertPageFileOptions {
  readonly title?: string
  readonly description?: string
  readonly icon?: string
  readonly coverUrl?: string
  readonly coverPosition?: string
  readonly labels?: readonly string[]
  readonly status?: PageStatus
  readonly locale?: string | null
  readonly navOrder?: number | null
  readonly pinned?: boolean
}

export interface UpsertPageFileResult {
  readonly page: Page
  readonly created: boolean
  readonly previous?: Page
}

export interface PageService {
  list(): PageSummary[]
  allActive(): Page[]
  trash(): PageSummary[]
  spaces(): PageSpace[]
  graph(): PageGraph
  backlinks(path: string): PageBacklink[]
  labels(): LabelCount[]
  brokenLinks(): BrokenLink[]
  recentChanges(limit?: number, before?: number | null, canRead?: (path: string) => boolean): RecentChange[]
  redirects(principal: Principal | null): Result<PageRedirectView[], AppError>
  createRedirect(fromPath: string, toPath: string, principal: Principal | null): Result<PageRedirectView, AppError>
  deleteRedirect(fromPath: string, principal: Principal | null): Result<{ fromPath: string }, AppError>
  events(): ExtractedCalendarEvent[]
  history(path: string): Result<PageRevisionSummary[], AppError>
  revisionInsights(path: string): Result<PageRevisionInsight, AppError>
  getByPath(path: string): Result<Page, AppError>
  resolveByPath(path: string): Result<ResolvedPage, AppError>
  create(input: PageInput, principal: Principal | null): Result<Page, AppError>
  copy(fromPath: string, newPath: string, principal: Principal | null, keepStatus?: boolean): Result<Page, AppError>
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

type PageWriteTransaction = Parameters<Parameters<DB['transaction']>[0]>[0]

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

export interface RewriteLinksForMoveOptions {
  readonly principal: Principal | null
  readonly now: number
  readonly reindex: (
    page: Pick<Page, 'id' | 'title' | 'description'>,
    content: string,
  ) => void
  readonly renderMarkdown?: (content: string) => RenderResult
}

export const rewriteLinksForMove = (
  tx: PageWriteTransaction,
  oldPath: string,
  newPath: string,
  { principal, now, reindex, renderMarkdown: renderMarkdownOverride }: RewriteLinksForMoveOptions,
): number => {
  const render = renderMarkdownOverride ?? renderMarkdown
  let rewritten = 0
  for (const page of tx.select().from(pages).where(eq(pages.lifecycle, 'active')).all()) {
    const content = rewritePageLinks(page.content, oldPath, newPath)
    if (content === page.content) continue
    const { html, toc } = render(content)
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
    reindex(page, content)
    rewritten += 1
  }
  return rewritten
}

export interface PageServiceOptions {
  readonly renderMarkdown?: (content: string) => RenderResult
  readonly defaultLocale?: () => string
}

export const createPageService = (
  db: DB,
  searchIndexer: SearchIndexer,
  options: PageServiceOptions = {},
): PageService => {
  const renderPageMarkdown = options.renderMarkdown ?? renderMarkdown
  const defaultLocale = options.defaultLocale ?? (() => 'und')
  let derivedVersion = 0
  const reindex = (id: string): void => {
    derivedVersion += 1
    searchIndexer.indexPageById(id)
  }
  const removeFromIndex = (id: string): void => {
    derivedVersion += 1
    searchIndexer.removePage(id)
  }

  interface DerivedPageData {
    readonly path: string
    readonly title: string
    readonly links: ReturnType<typeof extractPageLinks>
    readonly events: ExtractedCalendarEvent[]
  }
  let derivedCache: { signature: string; pages: DerivedPageData[] } | null = null
  const derivedPages = (): DerivedPageData[] => {
    const stamp = db
      .select({
        count: sql<number>`count(*)`,
        latest: sql<number>`coalesce(max(${pages.updatedAt}), 0)`,
        total: sql<number>`coalesce(sum(${pages.updatedAt}), 0)`,
      })
      .from(pages)
      .where(eq(pages.lifecycle, 'active'))
      .get()
    const signature = `${derivedVersion}:${stamp?.count ?? 0}:${stamp?.latest ?? 0}:${stamp?.total ?? 0}`
    if (derivedCache?.signature === signature) return derivedCache.pages
    const indexed = db
      .select({ path: pages.path, title: pages.title, content: pages.content })
      .from(pages)
      .where(eq(pages.lifecycle, 'active'))
      .orderBy(asc(pages.path))
      .all()
      .map((page) => ({
        path: page.path,
        title: page.title,
        links: extractPageLinks(page.content),
        events: extractCalendarEvents(page.content, page.path),
      }))
    derivedCache = { signature, pages: indexed }
    return indexed
  }

  const findByPath = (path: string): Page | undefined =>
    db.select().from(pages).where(eq(pages.path, normalizePath(path))).get()

  const findById = (id: string): Page | undefined =>
    db.select().from(pages).where(eq(pages.id, id)).get()

  const findRedirect = (path: string): string | null =>
    db.select().from(pageRedirects).where(eq(pageRedirects.fromPath, normalizePath(path))).get()?.toPath ?? null

  const requirePagePermission = (
    principal: Principal | null,
    action: Parameters<typeof requirePermission>[1],
    path?: string,
  ): Result<true, AppError> => requirePermission(principal, action, path ? { path } : {})

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

  const parseLabels = (value: string): string[] => normalizeLabels(parseJsonStringArray(value))

  const writeExistingPage = (
    current: Page,
    next: {
      title: string
      description: string
      content: string
      icon: string
      coverUrl: string
      coverPosition: string
      labels: readonly string[]
      status: PageStatus
      ownerId: string | null
      reviewAt: number | null
      publishAt: number | null
      locale: string
      navOrder: number | null
      pinned: boolean
    },
    principal: Principal | null,
    revisionAction: 'updated' | null,
  ): Page | undefined => {
    const { html, toc } = renderPageMarkdown(next.content)
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
          icon: next.icon,
          coverUrl: next.coverUrl,
          coverPosition: next.coverPosition,
          renderedHtml: html,
          toc: JSON.stringify(toc),
          labels: JSON.stringify(next.labels),
          status: next.status,
          ownerId: next.ownerId,
          reviewAt: next.reviewAt,
          publishAt: next.publishAt,
          locale: next.locale,
          navOrder: next.navOrder,
          pinned: next.pinned,
          updatedAt: now,
        })
        .where(eq(pages.id, current.id))
        .run()

      reindex(current.id)
      return findById(current.id)
    })
  }

  return {
    allActive() {
      return db.select().from(pages).where(eq(pages.lifecycle, 'active')).orderBy(asc(pages.path)).all()
    },

    list() {
      return db
        .select({
          path: pages.path,
          title: pages.title,
          description: pages.description,
          icon: pages.icon,
          coverUrl: pages.coverUrl,
          coverPosition: pages.coverPosition,
          lifecycle: pages.lifecycle,
          status: pages.status,
          labels: pages.labels,
          ownerId: pages.ownerId,
          authorId: pages.authorId,
          reviewAt: pages.reviewAt,
          publishAt: pages.publishAt,
          navOrder: pages.navOrder,
          pinned: pages.pinned,
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
          icon: pages.icon,
          coverUrl: pages.coverUrl,
          coverPosition: pages.coverPosition,
          lifecycle: pages.lifecycle,
          status: pages.status,
          labels: pages.labels,
          ownerId: pages.ownerId,
          authorId: pages.authorId,
          reviewAt: pages.reviewAt,
          publishAt: pages.publishAt,
          navOrder: pages.navOrder,
          pinned: pages.pinned,
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
      const allPages = derivedPages()
      const existing = new Map(allPages.map((page) => [page.path, page]))
      const missing = new Set<string>()
      const edgeKeys = new Set<string>()
      const edges: PageGraphEdge[] = []

      for (const page of allPages) {
        for (const link of page.links) {
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
      for (const page of derivedPages()) {
        for (const link of page.links) {
          if (link.path !== target) continue
          const key = `${page.path}\u0000${link.kind}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ path: page.path, title: page.title, label: link.label, kind: link.kind })
        }
      }
      return out
    },

    labels() {
      const counts = new Map<string, number>()
      for (const page of db.select({ labels: pages.labels }).from(pages).where(eq(pages.lifecycle, 'active')).all()) {
        for (const label of parseLabels(page.labels)) {
          counts.set(label, (counts.get(label) ?? 0) + 1)
        }
      }
      return [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    },

    brokenLinks() {
      const allPages = derivedPages()
      const existing = new Set(allPages.map((page) => page.path))
      const out: BrokenLink[] = []
      const seen = new Set<string>()
      for (const page of allPages) {
        for (const link of page.links) {
          if (link.path === page.path || existing.has(link.path)) continue
          const key = `${page.path}\u0000${link.path}\u0000${link.kind}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ path: page.path, title: page.title, target: link.path, label: link.label, kind: link.kind })
        }
      }
      return out
    },

    recentChanges(limit = 50, before = null, canRead) {
      const capped = Math.min(Math.max(limit, 1), 200)
      const selection = {
        id: pageRevisions.id,
        path: pageRevisions.path,
        title: pageRevisions.title,
        action: pageRevisions.action,
        authorId: pageRevisions.authorId,
        authorName: users.name,
        createdAt: pageRevisions.createdAt,
      }
      const fetchBatch = (cursor: number | null, batchSize: number) => {
        const query = db.select(selection).from(pageRevisions).leftJoin(users, eq(users.id, pageRevisions.authorId))
        return cursor === null
          ? query.orderBy(desc(pageRevisions.createdAt), sql`page_revisions.rowid desc`).limit(batchSize).all()
          : query.where(lt(pageRevisions.createdAt, cursor)).orderBy(desc(pageRevisions.createdAt), sql`page_revisions.rowid desc`).limit(batchSize).all()
      }
      const readable: RecentChange[] = []
      const batchSize = Math.min(Math.max(capped * 3, 50), 500)
      let cursor = before ?? null
      for (let batch = 0; batch < 20 && readable.length < capped; batch += 1) {
        const rows = fetchBatch(cursor, batchSize)
        if (!rows.length) break
        for (const row of rows) {
          if (!canRead || canRead(row.path)) readable.push({ ...row, authorName: row.authorName ?? null })
          if (readable.length === capped) break
        }
        if (rows.length < batchSize) break
        cursor = rows.at(-1)?.createdAt ?? null
      }
      return readable
    },

    redirects(principal) {
      const allowed = requirePagePermission(principal, 'page:update')
      if (!allowed.ok) return allowed
      return ok(db.select().from(pageRedirects).orderBy(asc(pageRedirects.fromPath)).all())
    },

    createRedirect(fromPath, toPath, principal) {
      const from = normalizePath(fromPath)
      const to = normalizePath(toPath)
      const allowed = requirePagePermission(principal, 'page:update', to)
      if (!allowed.ok) return allowed
      if (!from || !to) return err(validationError('Redirect paths are required', 'fromPath'))
      if (from === to) return err(conflict('Redirect source and target must be different'))
      const sourcePage = findByPath(from)
      if (sourcePage?.lifecycle === 'active') return err(conflict(`A page already exists at "${from}"`))
      const existing = findRedirect(from)
      if (existing) return err(conflict(`A redirect already exists at "${from}"`))
      const resolved = resolvePath(to)
      if (!resolved.ok) return resolved
      const target = resolved.value.page.path
      if (target === from) return err(conflict('Redirect would create a loop'))
      const redirect = { fromPath: from, toPath: target, createdAt: Date.now() }
      db.insert(pageRedirects).values(redirect).run()
      return ok(redirect)
    },

    deleteRedirect(fromPath, principal) {
      const from = normalizePath(fromPath)
      const allowed = requirePagePermission(principal, 'page:update', from)
      if (!allowed.ok) return allowed
      const existing = findRedirect(from)
      if (!existing) return err(notFound(`No redirect at "${from}"`))
      db.delete(pageRedirects).where(eq(pageRedirects.fromPath, from)).run()
      return ok({ fromPath: from })
    },

    events() {
      return derivedPages()
        .flatMap((page) => page.events)
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
          authorName: users.name,
          action: pageRevisions.action,
          createdAt: pageRevisions.createdAt,
        })
        .from(pageRevisions)
        .leftJoin(users, eq(users.id, pageRevisions.authorId))
        .where(eq(pageRevisions.pageId, page.id))
        // Tie-break equal timestamps by insertion order (SQLite rowid) so
        // revisions created in the same millisecond still sort deterministically
        // newest-first. Qualify rowid — the users join makes a bare `rowid` ambiguous.
        .orderBy(desc(pageRevisions.createdAt), sql`page_revisions.rowid desc`)
        .all()
      return ok(revisions.map((r) => ({ ...r, authorName: r.authorName ?? null })))
    },

    revisionInsights(path) {
      const page = findByPath(path)
      if (page?.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      const revisionCount = Number(
        db
          .select({ total: sql<number>`count(*)` })
          .from(pageRevisions)
          .where(eq(pageRevisions.pageId, page.id))
          .get()?.total ?? 0,
      )
      const lastContributionAt = sql<number>`max(${pageRevisions.createdAt})`
      const contributors = db
        .select({
          authorId: pageRevisions.authorId,
          authorName: users.name,
          revisions: sql<number>`count(*)`,
          lastContributionAt,
        })
        .from(pageRevisions)
        .leftJoin(users, eq(users.id, pageRevisions.authorId))
        .where(eq(pageRevisions.pageId, page.id))
        .groupBy(pageRevisions.authorId, users.name)
        .orderBy(desc(lastContributionAt), asc(users.name))
        .all()
        .map((row) => ({
          authorId: row.authorId,
          authorName: row.authorName ?? (row.authorId ? 'Unknown user' : 'Unknown'),
          revisions: Number(row.revisions),
          lastContributionAt: Number(row.lastContributionAt),
        }))
      return ok({ revisionCount, contributors })
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
      const validated = validatePageInput({ ...input, locale: input.locale ?? defaultLocale() })
      if (!validated.ok) return validated
      const v = validated.value
      const allowed = requirePagePermission(principal, 'page:create', v.path)
      if (!allowed.ok) return allowed

      const existing = findByPath(v.path)
      if (existing) return err(pathConflict(existing, v.path))

      const { html, toc } = renderPageMarkdown(v.content)
      const now = Date.now()
      const id = crypto.randomUUID()

      let page: Page | undefined
      try {
        page = db.transaction((tx) => {
          tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, v.path)).run()
          tx.insert(pages)
          .values({
            id,
            path: v.path,
            title: v.title,
            description: v.description,
            content: v.content,
            icon: v.icon,
            coverUrl: v.coverUrl,
            coverPosition: v.coverPosition,
            renderedHtml: html,
            toc: JSON.stringify(toc),
            contentType: 'markdown',
            lifecycle: 'active',
            labels: JSON.stringify(v.labels),
            status: v.status,
            ownerId: v.ownerId,
            reviewAt: v.reviewAt,
            publishAt: v.publishAt,
            navOrder: v.navOrder,
            pinned: v.pinned,
            spaceKey: v.path.split('/')[0] || 'main',
            locale: v.locale,
            authorId: principal?.id ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .run()

        snapshotRevision(tx, { id, path: v.path, title: v.title, description: v.description, content: v.content }, principal, 'created', now)

        reindex(id)
          return findById(id)
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) return err(conflict(`A page already exists at "${v.path}"`))
        throw error
      }
      return page ? ok(page) : err(notFound('Page disappeared while it was being created'))
    },

    copy(fromPath, newPath, principal, keepStatus = false) {
      const source = findByPath(fromPath)
      if (!source || source.lifecycle !== 'active') return err(notFound(`No page at "${fromPath}"`))
      const readable = requirePagePermission(principal, 'page:read', source.path)
      if (!readable.ok) return readable
      return this.create({
        path: newPath,
        title: `${source.title} (copy)`,
        content: source.content,
        description: source.description,
        icon: source.icon,
        coverUrl: source.coverUrl,
        coverPosition: source.coverPosition,
        labels: parseLabels(source.labels),
        status: keepStatus && isPageStatus(source.status) ? source.status : 'draft',
        ownerId: principal?.id ?? source.ownerId,
        reviewAt: null,
        publishAt: null,
        locale: source.locale,
      }, principal)
    },

    update(path, patch, principal) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      const allowed = requirePagePermission(principal, 'page:update', current.path)
      if (!allowed.ok) return allowed
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
        icon: patch.icon ?? current.icon,
        coverUrl: patch.coverUrl ?? current.coverUrl,
        coverPosition: patch.coverPosition ?? current.coverPosition,
        labels: patch.labels ?? parseLabels(current.labels),
        status: patch.status ?? current.status,
        ownerId: patch.ownerId === undefined ? current.ownerId : patch.ownerId,
        reviewAt: patch.reviewAt === undefined ? current.reviewAt : patch.reviewAt,
        publishAt: patch.publishAt === undefined ? current.publishAt : patch.publishAt,
        locale: patch.locale ?? current.locale,
        navOrder: patch.navOrder === undefined ? current.navOrder : patch.navOrder,
        pinned: patch.pinned ?? current.pinned,
      })
      if (!validated.ok) return validated
      const v = validated.value

      const page = writeExistingPage(current, v, principal, 'updated')
      return page ? ok(page) : err(notFound(`Page "${path}" disappeared while it was being updated`))
    },

    upsertFromFile(path, file, options, principal) {
      const title = (options.title ?? file.title).trim() || normalizePath(path).split('/').at(-1) || 'Imported page'
      const description = options.description ?? file.description
      const content = contentWithTocFrontmatter(file)
      const existing = this.getByPath(path)
      if (existing.ok) {
        const page = this.update(path, {
          title,
          description,
          content,
          icon: options.icon ?? file.icon,
          coverUrl: options.coverUrl ?? file.coverUrl,
          coverPosition: options.coverPosition ?? file.coverPosition,
          labels: options.labels,
          status: options.status,
          locale: options.locale,
          navOrder: options.navOrder,
          pinned: options.pinned,
        }, principal)
        if (!page.ok) return page
        return ok({ page: page.value, created: false, previous: existing.value })
      }

      const page = this.create({
        path,
        title,
        description,
        content,
        icon: options.icon ?? file.icon,
        coverUrl: options.coverUrl ?? file.coverUrl,
        coverPosition: options.coverPosition ?? file.coverPosition,
        labels: options.labels,
        status: options.status,
        locale: options.locale,
        navOrder: options.navOrder,
        pinned: options.pinned,
      }, principal)
      if (!page.ok) return page
      return ok({ page: page.value, created: true })
    },

    saveContent(path, content, principal, expectedUpdatedAt = null) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      const allowed = requirePagePermission(principal, 'page:update', current.path)
      if (!allowed.ok) return allowed
      if (expectedUpdatedAt !== null && current.updatedAt !== expectedUpdatedAt) {
        return err(conflict(`Page "${path}" changed outside the collaborative editor`))
      }

      const validated = validatePageInput({
        path: current.path,
        title: current.title,
        content,
        labels: parseLabels(current.labels),
        icon: current.icon,
        coverUrl: current.coverUrl,
        coverPosition: current.coverPosition,
        status: isPageStatus(current.status) ? current.status : 'draft',
        ownerId: current.ownerId,
        reviewAt: current.reviewAt,
        publishAt: current.publishAt,
        locale: current.locale,
        navOrder: current.navOrder,
        pinned: current.pinned,
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
      return page ? ok(page) : err(notFound(`Page "${path}" disappeared while it was being saved`))
    },

    restoreRevision(path, revisionId, principal) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      const allowed = requirePagePermission(principal, 'page:update', current.path)
      if (!allowed.ok) return allowed
      const revision = db.select().from(pageRevisions).where(eq(pageRevisions.id, revisionId)).get()
      if (!revision || revision.pageId !== current.id) return err(notFound('Revision not found'))

      const page = writeExistingPage(
        current,
        {
          title: revision.title,
          description: revision.description,
          content: revision.content,
          labels: parseLabels(current.labels),
          icon: current.icon,
          coverUrl: current.coverUrl,
          coverPosition: current.coverPosition,
          status: isPageStatus(current.status) ? current.status : 'draft',
          ownerId: current.ownerId,
          reviewAt: current.reviewAt,
          publishAt: current.publishAt,
          locale: normalizeLocale(current.locale),
          navOrder: current.navOrder,
          pinned: current.pinned,
        },
        principal,
        'updated',
      )
      return page ? ok(page) : err(notFound(`Page "${path}" disappeared while its revision was being restored`))
    },

    archive(path, principal) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      const allowed = requirePagePermission(principal, 'page:delete', current.path)
      if (!allowed.ok) return allowed
      const now = Date.now()
      const page = db.transaction((tx) => {
        snapshotRevision(tx, current, principal, 'archived', now)
        tx.update(pages)
          .set({ lifecycle: 'archived', updatedAt: now })
          .where(eq(pages.id, current.id))
          .run()
        removeFromIndex(current.id)
        return findById(current.id)
      })
      return page ? ok(page) : err(notFound(`Page "${path}" disappeared while it was being archived`))
    },

    restore(path, principal) {
      const current = findByPath(path)
      if (!current) return err(notFound(`No page at "${path}"`))
      const allowed = requirePagePermission(principal, 'page:update', current.path)
      if (!allowed.ok) return allowed
      if (current.lifecycle === 'active') return ok(current)
      const now = Date.now()
      const page = db.transaction((tx) => {
        snapshotRevision(tx, current, principal, 'restored', now)
        tx.update(pages)
          .set({ lifecycle: 'active', updatedAt: now })
          .where(eq(pages.id, current.id))
          .run()
        reindex(current.id)
        return findById(current.id)
      })
      return page ? ok(page) : err(notFound(`Page "${path}" disappeared while it was being restored`))
    },

    move(oldPath, newPath, principal) {
      const current = findByPath(oldPath)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${oldPath}"`))
      const allowed = requirePagePermission(principal, 'page:move', current.path)
      if (!allowed.ok) return allowed

      const validated = validatePageInput({
        path: newPath,
        title: current.title,
        content: current.content,
        description: current.description,
        labels: parseLabels(current.labels),
        icon: current.icon,
        coverUrl: current.coverUrl,
        coverPosition: current.coverPosition,
        status: isPageStatus(current.status) ? current.status : 'draft',
        ownerId: current.ownerId,
        reviewAt: current.reviewAt,
        publishAt: current.publishAt,
        locale: current.locale,
        navOrder: current.navOrder,
        pinned: current.pinned,
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

        rewriteLinksForMove(tx, current.path, v.path, {
          principal,
          now,
          reindex: (page) => reindex(page.id),
          renderMarkdown: renderPageMarkdown,
        })

        reindex(current.id)
        return findById(current.id)
      })
      return page ? ok(page) : err(notFound(`Page "${oldPath}" disappeared while it was being moved`))
    },

    remove(path, principal) {
      const current = findByPath(path)
      if (!current || current.lifecycle !== 'active') return err(notFound(`No page at "${path}"`))
      const allowed = requirePagePermission(principal, 'page:delete', current.path)
      if (!allowed.ok) return allowed

      const now = Date.now()
      const deleted = db.transaction((tx) => {
        snapshotRevision(tx, current, principal, 'deleted', now)

        tx.update(pages)
          .set({ lifecycle: 'deleted', updatedAt: now })
          .where(eq(pages.id, current.id))
          .run()
        tx.delete(pageRedirects).where(eq(pageRedirects.fromPath, current.path)).run()
        tx.delete(pageRedirects).where(eq(pageRedirects.toPath, current.path)).run()
        removeFromIndex(current.id)
        return findById(current.id)
      })
      return deleted ? ok({ path: deleted.path }) : err(notFound(`Page "${path}" disappeared while it was being deleted`))
    },

    purge(path, principal) {
      const allowed = requirePagePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed

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
        removeFromIndex(current.id)
      })
      return ok({ path: current.path })
    },
  }
}
