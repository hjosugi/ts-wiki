import {
  type AppError,
  type Principal,
  type Result,
  err,
  forbidden,
  normalizePath,
  notFound,
  ok,
  requirePermission,
  validationError,
} from '@kawaii-wiki/core'
import type { CommentRecord, CommentRepository } from '../repositories/comments.ts'
import type { SearchIndexer } from './search.ts'

export interface CommentView {
  readonly id: string
  readonly path: string
  readonly body: string
  readonly authorId: string | null
  /** Display name of the author, or null if unknown/deleted. */
  readonly authorName: string | null
  readonly mentions: string[]
  readonly resolvedAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type CommentAccessMode = 'off' | 'read-only' | 'authenticated' | 'group' | 'open'

export interface CommentPolicyView {
  readonly mode: CommentAccessMode
  readonly visible: boolean
  readonly writable: boolean
  readonly groupKey: string | null
}

export interface CommentService {
  policy(path: string, principal: Principal | null): Promise<Result<CommentPolicyView, AppError>>
  list(path: string): Promise<Result<CommentView[], AppError>>
  create(path: string, body: string, principal: Principal | null): Promise<Result<CommentView, AppError>>
  update(id: string, body: string, principal: Principal | null): Promise<Result<CommentView, AppError>>
  resolve(id: string, principal: Principal | null): Promise<Result<CommentView, AppError>>
  remove(id: string, principal: Principal | null): Promise<Result<{ id: string; path: string }, AppError>>
}

const mentionsOf = (body: string): string[] => {
  const seen = new Set<string>()
  for (const match of body.matchAll(/@([A-Za-z0-9._-]{2,80})/g)) {
    const mention = match[1]?.toLowerCase()
    if (mention) seen.add(mention)
  }
  return [...seen]
}

const toView = (comment: CommentRecord, authorName: string | null): CommentView => ({
  id: comment.id,
  path: comment.path,
  body: comment.body,
  authorId: comment.authorId,
  authorName,
  mentions: mentionsOf(comment.body),
  resolvedAt: comment.resolvedAt,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
})

export const createCommentService = (repository: CommentRepository, searchIndexer?: SearchIndexer): CommentService => {
  const nameOf = async (id: string | null): Promise<string | null> =>
    id ? repository.findAuthorName(id) : null

  const canMutate = (principal: Principal | null, comment: CommentRecord): boolean =>
    Boolean(principal && (principal.id === comment.authorId || requirePermission(principal, 'admin:access').ok))

  const cleanBody = (body: string): Result<string, AppError> => {
    const clean = body.trim()
    if (!clean) return err(validationError('Comment body is required', 'body'))
    if (clean.length > 5000) return err(validationError('Comment body must be 5000 characters or fewer', 'body'))
    return ok(clean)
  }

  const policyFor = (page: { labels: string }, principal: Principal | null): CommentPolicyView => {
    const labels = new Set<string>()
    try {
      const parsed = JSON.parse(page.labels) as unknown
      if (Array.isArray(parsed)) for (const label of parsed) if (typeof label === 'string') labels.add(label)
    } catch {
      // Invalid legacy labels fall back to the safe authenticated default.
    }
    const groupLabel = [...labels].find((label) => label.startsWith('kawaii-wiki-comments-group-'))
    const groupKey = groupLabel?.slice('kawaii-wiki-comments-group-'.length).trim() || null
    const mode: CommentAccessMode = labels.has('kawaii-wiki-comments-off')
      ? 'off'
      : labels.has('kawaii-wiki-comments-read-only')
        ? 'read-only'
        : labels.has('kawaii-wiki-comments-open')
          ? 'open'
          : groupKey
            ? 'group'
            : 'authenticated'
    const writable = mode === 'open'
      || (mode === 'authenticated' && Boolean(principal && requirePermission(principal, 'comment:write').ok))
      || (mode === 'group' && Boolean(principal?.groups?.includes(groupKey ?? '')))
    return { mode, visible: mode !== 'off', writable, groupKey }
  }

  return {
    async policy(path, principal) {
      const page = await repository.findActivePage(normalizePath(path))
      if (!page) return err(notFound(`No page at "${path}"`))
      return ok(policyFor(page, principal))
    },

    async list(path) {
      const page = await repository.findActivePage(normalizePath(path))
      if (!page) return err(notFound(`No page at "${path}"`))
      const rows = await repository.listByPageId(page.id)
      return ok(rows.map((row) => toView(row.comment, row.authorName ?? null)))
    },

    async create(path, body, principal) {
      const page = await repository.findActivePage(normalizePath(path))
      if (!page) return err(notFound(`No page at "${path}"`))
      const commentPolicy = policyFor(page, principal)
      if (!commentPolicy.writable) return err(forbidden('Comments are not open to this account'))
      const clean = cleanBody(body)
      if (!clean.ok) return clean
      const now = Date.now()
      const comment: CommentRecord = {
        id: crypto.randomUUID(),
        pageId: page.id,
        path: page.path,
        body: clean.value,
        authorId: principal?.id ?? null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await repository.insert(comment)
      await searchIndexer?.indexPageById(page.id)
      return ok(toView(comment, await nameOf(comment.authorId)))
    },

    async update(id, body, principal) {
      const comment = await repository.findById(id)
      if (!comment) return err(notFound('Comment not found'))
      if (!canMutate(principal, comment)) return err(forbidden())
      const clean = cleanBody(body)
      if (!clean.ok) return clean
      const updated = { ...comment, body: clean.value, updatedAt: Date.now() }
      if (!await repository.updateBody(id, updated.body, updated.updatedAt)) return err(notFound('Comment not found'))
      await searchIndexer?.indexPageById(comment.pageId)
      return ok(toView(updated, await nameOf(updated.authorId)))
    },

    async resolve(id, principal) {
      const comment = await repository.findById(id)
      if (!comment) return err(notFound('Comment not found'))
      if (!canMutate(principal, comment)) return err(forbidden())
      const now = Date.now()
      const updated = { ...comment, resolvedAt: now, updatedAt: now }
      if (!await repository.resolve(id, now, now)) return err(notFound('Comment not found'))
      return ok(toView(updated, await nameOf(updated.authorId)))
    },

    async remove(id, principal) {
      const comment = await repository.findById(id)
      if (!comment) return err(notFound('Comment not found'))
      if (!canMutate(principal, comment)) return err(forbidden())
      if (!await repository.delete(id)) return err(notFound('Comment not found'))
      await searchIndexer?.indexPageById(comment.pageId)
      return ok({ id, path: comment.path })
    },
  }
}
