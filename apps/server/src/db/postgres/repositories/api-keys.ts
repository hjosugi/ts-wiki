import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import { isUniqueConstraintError } from '../../errors.ts'
import type { PostgresDb } from '../client.ts'
import { apiKeys } from '../schema.ts'
import {
  DuplicateApiKeyHashError,
  type ApiKeyRepository,
} from '../../../repositories/api-keys.ts'

/** PostgreSQL implementation of the driver-neutral API-key contract. */
export const createPostgresApiKeyRepository = (db: PostgresDb): ApiKeyRepository => ({
  async list() {
    return db.select().from(apiKeys).orderBy(asc(apiKeys.createdAt))
  },

  async findById(id) {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
    return row
  },

  async findByHash(keyHash) {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1)
    return row
  },

  async insert(apiKey) {
    try {
      await db.insert(apiKeys).values(apiKey)
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicateApiKeyHashError()
      throw error
    }
  },

  async revoke(id, revokedAt) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
      if (!row) return undefined
      if (row.revokedAt === null) {
        await tx.update(apiKeys).set({ revokedAt }).where(eq(apiKeys.id, id))
        return { ...row, revokedAt }
      }
      return row
    })
  },

  async markUsedIfActive(id, usedAt) {
    const updated = await db
      .update(apiKeys)
      .set({ lastUsedAt: usedAt })
      .where(and(
        eq(apiKeys.id, id),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, usedAt)),
      ))
      .returning({ id: apiKeys.id })
    return updated.length > 0
  },
})
