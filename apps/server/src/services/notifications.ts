import { and, desc, eq } from 'drizzle-orm'
import { err, normalizePath, notFound, ok, type AppError, type Principal, type Result, unauthorized, requirePermission } from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import { notifications, pages, pageWatchers, users } from '../db/schema.ts'
import type { CommentView } from './comments.ts'

export interface NotificationView {
  readonly id: string
  readonly kind: string
  readonly path: string | null
  readonly message: string
  readonly payload: Record<string, unknown>
  readonly readAt: number | null
  readonly createdAt: number
}

export interface NotificationList {
  readonly notifications: NotificationView[]
  readonly unread: number
}

export interface NotificationService {
  list(principal: Principal | null, limit?: number): Result<NotificationList, AppError>
  markRead(principal: Principal | null, id?: string): Result<{ readAt: number }, AppError>
  watch(principal: Principal | null, path: string, watching: boolean): Result<{ path: string; watching: boolean }, AppError>
  watching(principal: Principal | null, path: string): Result<{ path: string; watching: boolean }, AppError>
  notifyComment(comment: CommentView): void
  pageChanged(action: string, path: string, from: string | undefined, actorId: string | null): void
}

const parsePayload = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export const createNotificationService = (db: DB): NotificationService => {
  const requireUser = (principal: Principal | null): Result<Principal, AppError> =>
    principal ? ok(principal) : err(unauthorized())

  const insert = (userId: string, kind: string, path: string | null, message: string, payload: Record<string, unknown>): void => {
    db.insert(notifications).values({
      id: crypto.randomUUID(),
      userId,
      kind,
      path,
      message,
      payload: JSON.stringify(payload),
      readAt: null,
      createdAt: Date.now(),
    }).run()
  }

  const requireVisiblePage = (principal: Principal, path: string): Result<void, AppError> => {
    const allowed = requirePermission(principal, 'page:read', { path })
    if (!allowed.ok) return allowed
    const page = db.select({ status: pages.status, publishAt: pages.publishAt }).from(pages).where(eq(pages.path, path)).get()
    if (!page) return err(notFound(`No page at "${path}"`))
    const unpublished = page.status === 'draft' || (page.publishAt !== null && page.publishAt > Date.now())
    if (unpublished && !requirePermission(principal, 'page:update', { path }).ok) {
      return err(notFound(`No page at "${path}"`))
    }
    return ok(undefined)
  }

  return {
    list(principal, limit = 50) {
      const user = requireUser(principal)
      if (!user.ok) return user
      const capped = Math.min(Math.max(Math.trunc(limit), 1), 100)
      const rows = db.select().from(notifications)
        .where(eq(notifications.userId, user.value.id))
        .orderBy(desc(notifications.createdAt))
        .limit(capped)
        .all()
        .filter((row) => !row.path || requirePermission(principal, 'page:read', { path: row.path }).ok)
      const unread = rows.filter((row) => row.readAt === null).length
      return ok({
        notifications: rows.map((row) => ({ ...row, payload: parsePayload(row.payload) })),
        unread,
      })
    },

    markRead(principal, id) {
      const user = requireUser(principal)
      if (!user.ok) return user
      const readAt = Date.now()
      const where = id
        ? and(eq(notifications.userId, user.value.id), eq(notifications.id, id))
        : eq(notifications.userId, user.value.id)
      db.update(notifications).set({ readAt }).where(where).run()
      return ok({ readAt })
    },

    watch(principal, path, watching) {
      const user = requireUser(principal)
      if (!user.ok) return user
      const normalized = normalizePath(path)
      const allowed = requireVisiblePage(user.value, normalized)
      if (!allowed.ok) return allowed
      if (watching) {
        db.insert(pageWatchers).values({ userId: user.value.id, path: normalized, createdAt: Date.now() })
          .onConflictDoNothing().run()
      } else {
        db.delete(pageWatchers).where(and(eq(pageWatchers.userId, user.value.id), eq(pageWatchers.path, normalized))).run()
      }
      return ok({ path: normalized, watching })
    },

    watching(principal, path) {
      const user = requireUser(principal)
      if (!user.ok) return user
      const normalized = normalizePath(path)
      const allowed = requireVisiblePage(user.value, normalized)
      if (!allowed.ok) return allowed
      const watching = Boolean(db.select().from(pageWatchers)
        .where(and(eq(pageWatchers.userId, user.value.id), eq(pageWatchers.path, normalized))).get())
      return ok({ path: normalized, watching })
    },

    notifyComment(comment) {
      const page = db.select().from(pages).where(eq(pages.path, comment.path)).get()
      if (!page) return
      const targets = new Set<string>()
      for (const user of db.select().from(users).all()) {
        const aliases = [
          user.name.toLowerCase().replace(/\s+/g, '.'),
          user.name.toLowerCase().replace(/\s+/g, ''),
          user.email.split('@')[0]?.toLowerCase() ?? '',
        ]
        if (comment.mentions.some((mention) => aliases.includes(mention))) targets.add(user.id)
      }
      if (page.ownerId) targets.add(page.ownerId)
      if (page.authorId) targets.add(page.authorId)
      if (comment.authorId) targets.delete(comment.authorId)
      for (const userId of targets) {
        insert(userId, 'comment', page.path, `${comment.authorName ?? 'Someone'} commented on ${page.title}`, { commentId: comment.id })
      }
    },

    pageChanged(action, path, from, actorId) {
      if (from && from !== path) {
        const movedWatchers = db.select().from(pageWatchers).where(eq(pageWatchers.path, from)).all()
        for (const watcher of movedWatchers) {
          db.insert(pageWatchers).values({ ...watcher, path }).onConflictDoNothing().run()
        }
        db.delete(pageWatchers).where(eq(pageWatchers.path, from)).run()
      }
      const page = db.select({ title: pages.title }).from(pages).where(eq(pages.path, path)).get()
      const title = page?.title ?? path
      const watchers = db.select().from(pageWatchers).where(eq(pageWatchers.path, path)).all()
      for (const watcher of watchers) {
        if (watcher.userId === actorId) continue
        insert(watcher.userId, 'page', path, `${title} was ${action}`, { action, from: from ?? null })
      }
      if (action === 'deleted') db.delete(pageWatchers).where(eq(pageWatchers.path, path)).run()
    },
  }
}
