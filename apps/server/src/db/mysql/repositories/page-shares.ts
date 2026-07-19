import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { isUniqueConstraintError } from '../../errors.ts'
import type { MysqlDb } from '../client.ts'
import { pageShares, pages } from '../schema.ts'
import {
  DuplicatePageShareTokenError,
  type PageShareRepository,
} from '../../../repositories/page-shares.ts'

/** MySQL implementation of the driver-neutral page-share contract. */
export const createMysqlPageShareRepository = (db: MysqlDb): PageShareRepository => ({
  async findActivePage(path) {
    const [row] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.path, path), eq(pages.lifecycle, 'active')))
      .limit(1)
    return row
  },

  async findByToken(token) {
    const [row] = await db.select().from(pageShares).where(eq(pageShares.token, token)).limit(1)
    return row
  },

  async findActiveForPath(path, now) {
    const [row] = await db
      .select()
      .from(pageShares)
      .where(
        and(
          eq(pageShares.path, path),
          isNull(pageShares.revokedAt),
          or(isNull(pageShares.expiresAt), gt(pageShares.expiresAt, now)),
        ),
      )
      .orderBy(desc(pageShares.createdAt))
      .limit(1)
    return row
  },

  async insert(share) {
    try {
      await db.insert(pageShares).values(share)
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicatePageShareTokenError()
      throw error
    }
  },

  async revoke(token, revokedAt) {
    return db.transaction(async (tx) => {
      const [share] = await tx.select().from(pageShares).where(eq(pageShares.token, token)).limit(1)
      if (!share) return undefined
      if (share.revokedAt === null) {
        await tx.update(pageShares).set({ revokedAt }).where(eq(pageShares.token, token))
        return { ...share, revokedAt }
      }
      return share
    })
  },
})
