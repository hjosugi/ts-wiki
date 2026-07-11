import { asc, eq } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { isUniqueConstraintError } from '../errors.ts'
import { apiKeys } from '../schema.ts'
import {
  DuplicateApiKeyHashError,
  type ApiKeyRepository,
} from '../../repositories/api-keys.ts'

export const createSqliteApiKeyRepository = (db: DB): ApiKeyRepository => ({
  async list() {
    return db.select().from(apiKeys).orderBy(asc(apiKeys.createdAt)).all()
  },

  async findById(id) {
    return db.select().from(apiKeys).where(eq(apiKeys.id, id)).get()
  },

  async findByHash(keyHash) {
    return db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).get()
  },

  async insert(apiKey) {
    try {
      db.insert(apiKeys).values(apiKey).run()
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicateApiKeyHashError()
      throw error
    }
  },

  async revoke(id, revokedAt) {
    return db.transaction((tx) => {
      const row = tx.select().from(apiKeys).where(eq(apiKeys.id, id)).get()
      if (!row) return undefined
      if (row.revokedAt === null) {
        tx.update(apiKeys).set({ revokedAt }).where(eq(apiKeys.id, id)).run()
        return { ...row, revokedAt }
      }
      return row
    })
  },

  async markUsedIfActive(id, usedAt) {
    const result = db.$client.prepare(`
      UPDATE api_keys
      SET last_used_at = ?
      WHERE id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `).run(usedAt, id, usedAt)
    return Number(result.changes ?? 0) > 0
  },
})
