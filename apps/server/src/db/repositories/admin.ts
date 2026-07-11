import { and, asc, desc, eq, gte, isNull, like, lte, sql, type SQL } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { auditLog, groupMemberships, groups, pageRevisions, pages, users } from '../schema.ts'
import type { AdminRepository, AdminUserRecord } from '../../repositories/admin.ts'

const userSelection = {
  id: users.id,
  email: users.email,
  name: users.name,
  passwordHash: users.passwordHash,
  role: users.role,
  disabledAt: users.disabledAt,
  tokenInvalidBefore: users.tokenInvalidBefore,
  createdAt: users.createdAt,
}

export const createSqliteAdminRepository = (db: DB): AdminRepository => ({
  async stats() {
    const usersCount = db.select({ count: sql<number>`count(*)` }).from(users).get()?.count ?? 0
    const pagesCount = db.select({ count: sql<number>`count(*)` }).from(pages).get()?.count ?? 0
    const revisionsCount = db.select({ count: sql<number>`count(*)` }).from(pageRevisions).get()?.count ?? 0
    return { users: usersCount, pages: pagesCount, revisions: revisionsCount }
  },

  async historyStats() {
    return {
      revisions: db.select({ count: sql<number>`count(*)` }).from(pageRevisions).get()?.count ?? 0,
      historyBytes: db.select({
        bytes: sql<number>`coalesce(sum(length(${pageRevisions.title}) + length(${pageRevisions.description}) + length(${pageRevisions.content})), 0)`,
      }).from(pageRevisions).get()?.bytes ?? 0,
    }
  },

  async listRevisionCandidates() {
    return db.select({ id: pageRevisions.id, pageId: pageRevisions.pageId, createdAt: pageRevisions.createdAt })
      .from(pageRevisions)
      .orderBy(desc(pageRevisions.createdAt), sql`page_revisions.rowid desc`)
      .all()
  },

  async deleteRevisions(ids) {
    db.transaction((tx) => {
      for (const id of ids) tx.delete(pageRevisions).where(eq(pageRevisions.id, id)).run()
    })
  },

  async listPages(query) {
    const filters: SQL[] = [
      eq(pages.lifecycle, 'active'),
      ...(query.status ? [eq(pages.status, query.status)] : []),
      ...(query.label ? [like(pages.labels, `%${query.label}%`)] : []),
      ...(query.spaceKey ? [eq(pages.spaceKey, query.spaceKey)] : []),
      ...(query.authorId ? [eq(pages.authorId, query.authorId)] : []),
    ]
    const where = and(...filters)
    const total = db.select({ count: sql<number>`count(*)` }).from(pages).where(where).get()?.count ?? 0
    const rows = db.select({
      path: pages.path,
      title: pages.title,
      status: pages.status,
      labels: pages.labels,
      ownerId: pages.ownerId,
      authorId: pages.authorId,
      authorName: users.name,
      spaceKey: pages.spaceKey,
      locale: pages.locale,
      updatedAt: pages.updatedAt,
    }).from(pages)
      .leftJoin(users, eq(users.id, pages.authorId))
      .where(where)
      .orderBy(desc(pages.updatedAt), asc(pages.path))
      .limit(query.limit)
      .offset(query.offset)
      .all()
    return { rows: rows.map((row) => ({ ...row, authorName: row.authorName ?? null })), total }
  },

  async listAudit(query) {
    const filters: SQL[] = [
      ...(query.action ? [like(auditLog.action, `%${query.action}%`)] : []),
      ...(query.userId ? [eq(auditLog.userId, query.userId)] : []),
      ...(query.from !== undefined ? [gte(auditLog.createdAt, query.from)] : []),
      ...(query.to !== undefined ? [lte(auditLog.createdAt, query.to)] : []),
    ]
    const where = filters.length ? and(...filters) : undefined
    const totalQuery = db.select({ count: sql<number>`count(*)` }).from(auditLog)
    const total = (where ? totalQuery.where(where) : totalQuery).get()?.count ?? 0
    const rowsQuery = db.select().from(auditLog)
    const rows = (where ? rowsQuery.where(where) : rowsQuery)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(query.limit)
      .offset(query.offset)
      .all()
    return { rows, total }
  },

  async listUsers() {
    return db.select(userSelection).from(users).orderBy(asc(users.createdAt)).all() as AdminUserRecord[]
  },

  async listGroupMemberships() {
    return db.select({ userId: groupMemberships.userId, key: groups.key })
      .from(groupMemberships)
      .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
      .all()
  },

  async findUser(id) {
    return db.select(userSelection).from(users).where(eq(users.id, id)).get() as AdminUserRecord | undefined
  },

  async activeAdminCount() {
    return db.select({ count: sql<number>`count(*)` }).from(users)
      .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
      .get()?.count ?? 0
  },

  async updateUserRole(id, role) {
    db.update(users).set({ role }).where(eq(users.id, id)).run()
  },

  async updateUserPassword(id, passwordHash, tokenInvalidBefore) {
    db.update(users).set({ passwordHash, tokenInvalidBefore }).where(eq(users.id, id)).run()
  },

  async deactivateUser(id, disabledAt) {
    db.update(users).set({ disabledAt, tokenInvalidBefore: disabledAt }).where(eq(users.id, id)).run()
  },
})
