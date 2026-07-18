import { and, desc, eq } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { notifications, pages, pageWatchers, users } from '../schema.ts'
import type { NotificationRepository } from '../../../repositories/notifications.ts'

/** PostgreSQL implementation of the driver-neutral notification contract. */
export const createPostgresNotificationRepository = (db: PostgresDb): NotificationRepository => ({
  async listByUser(userId, limit) {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
  },

  async markRead(userId, id, readAt) {
    const where = id
      ? and(eq(notifications.userId, userId), eq(notifications.id, id))
      : eq(notifications.userId, userId)
    await db.update(notifications).set({ readAt }).where(where)
  },

  async findPage(path) {
    const [row] = await db
      .select({
        path: pages.path,
        title: pages.title,
        status: pages.status,
        publishAt: pages.publishAt,
        ownerId: pages.ownerId,
        authorId: pages.authorId,
      })
      .from(pages)
      .where(eq(pages.path, path))
      .limit(1)
    return row
  },

  async listUsers() {
    return db.select({ id: users.id, email: users.email, name: users.name }).from(users)
  },

  async insert(notification) {
    await db.insert(notifications).values(notification)
  },

  async setWatching(userId, path, watching, createdAt) {
    if (watching) {
      await db.insert(pageWatchers).values({ userId, path, createdAt }).onConflictDoNothing()
      return
    }
    await db.delete(pageWatchers).where(and(eq(pageWatchers.userId, userId), eq(pageWatchers.path, path)))
  },

  async isWatching(userId, path) {
    const [row] = await db
      .select({ userId: pageWatchers.userId })
      .from(pageWatchers)
      .where(and(eq(pageWatchers.userId, userId), eq(pageWatchers.path, path)))
      .limit(1)
    return Boolean(row)
  },

  async listWatchers(path) {
    return db.select().from(pageWatchers).where(eq(pageWatchers.path, path))
  },

  async moveWatchers(fromPath, toPath) {
    await db.transaction(async (tx) => {
      const watchers = await tx.select().from(pageWatchers).where(eq(pageWatchers.path, fromPath))
      for (const watcher of watchers) {
        await tx.insert(pageWatchers).values({ ...watcher, path: toPath }).onConflictDoNothing()
      }
      await tx.delete(pageWatchers).where(eq(pageWatchers.path, fromPath))
    })
  },

  async deleteWatchers(path) {
    await db.delete(pageWatchers).where(eq(pageWatchers.path, path))
  },
})
