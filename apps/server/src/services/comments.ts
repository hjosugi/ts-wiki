import { eq, asc } from 'drizzle-orm'
import {
  type AppError,
  type Principal,
  type Result,
  can,
  err,
  forbidden,
  normalizePath,
  notFound,
  ok,
  validationError,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { pageComments, pages, type PageComment } from '../db/schema.ts'

export interface CommentView {
  readonly id: string
  readonly path: string
  readonly body: string
  readonly authorId: string | null
  readonly mentions: string[]
  readonly resolvedAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface CommentService {
  list(path: string): Result<CommentView[], AppError>
  create(path: string, body: string, principal: Principal | null): Result<CommentView, AppError>
  update(id: string, body: string, principal: Principal | null): Result<CommentView, AppError>
  resolve(id: string, principal: Principal | null): Result<CommentView, AppError>
  remove(id: string, principal: Principal | null): Result<{ id: string; path: string }, AppError>
}

const mentionsOf = (body: string): string[] => {
  const seen = new Set<string>()
  for (const match of body.matchAll(/@([A-Za-z0-9._-]{2,80})/g)) {
    const mention = match[1]?.toLowerCase()
    if (mention) seen.add(mention)
  }
  return [...seen]
}

const toView = (comment: PageComment): CommentView => ({
  id: comment.id,
  path: comment.path,
  body: comment.body,
  authorId: comment.authorId,
  mentions: mentionsOf(comment.body),
  resolvedAt: comment.resolvedAt,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
})

export const createCommentService = (db: DB): CommentService => {
  const findActivePage = (path: string) => {
    const page = db.select().from(pages).where(eq(pages.path, normalizePath(path))).get()
    return page?.lifecycle === 'active' ? page : null
  }

  const findComment = (id: string): PageComment | null =>
    db.select().from(pageComments).where(eq(pageComments.id, id)).get() ?? null

  const canMutate = (principal: Principal | null, comment: PageComment): boolean =>
    Boolean(principal && (principal.role === 'admin' || principal.id === comment.authorId))

  const cleanBody = (body: string): Result<string, AppError> => {
    const clean = body.trim()
    if (!clean) return err(validationError('Comment body is required', 'body'))
    if (clean.length > 5000) return err(validationError('Comment body must be 5000 characters or fewer', 'body'))
    return ok(clean)
  }

  return {
    list(path) {
      const page = findActivePage(path)
      if (!page) return err(notFound(`No page at "${path}"`))
      const comments = db
        .select()
        .from(pageComments)
        .where(eq(pageComments.pageId, page.id))
        .orderBy(asc(pageComments.createdAt))
        .all()
      return ok(comments.map(toView))
    },

    create(path, body, principal) {
      if (!principal || !can(principal, 'comment:write', { path })) return err(forbidden())
      const page = findActivePage(path)
      if (!page) return err(notFound(`No page at "${path}"`))
      const clean = cleanBody(body)
      if (!clean.ok) return clean
      const now = Date.now()
      const comment: PageComment = {
        id: crypto.randomUUID(),
        pageId: page.id,
        path: page.path,
        body: clean.value,
        authorId: principal.id,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(pageComments).values(comment).run()
      return ok(toView(comment))
    },

    update(id, body, principal) {
      const comment = findComment(id)
      if (!comment) return err(notFound('Comment not found'))
      if (!canMutate(principal, comment)) return err(forbidden())
      const clean = cleanBody(body)
      if (!clean.ok) return clean
      const updated = { ...comment, body: clean.value, updatedAt: Date.now() }
      db.update(pageComments)
        .set({ body: updated.body, updatedAt: updated.updatedAt })
        .where(eq(pageComments.id, id))
        .run()
      return ok(toView(updated))
    },

    resolve(id, principal) {
      const comment = findComment(id)
      if (!comment) return err(notFound('Comment not found'))
      if (!canMutate(principal, comment)) return err(forbidden())
      const updated = { ...comment, resolvedAt: Date.now(), updatedAt: Date.now() }
      db.update(pageComments)
        .set({ resolvedAt: updated.resolvedAt, updatedAt: updated.updatedAt })
        .where(eq(pageComments.id, id))
        .run()
      return ok(toView(updated))
    },

    remove(id, principal) {
      const comment = findComment(id)
      if (!comment) return err(notFound('Comment not found'))
      if (!canMutate(principal, comment)) return err(forbidden())
      db.delete(pageComments).where(eq(pageComments.id, id)).run()
      return ok({ id, path: comment.path })
    },
  }
}
