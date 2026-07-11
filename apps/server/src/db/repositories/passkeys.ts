import { and, eq, lt } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { isUniqueConstraintError } from '../errors.ts'
import { passkeys, webauthnChallenges } from '../schema.ts'
import {
  DuplicatePasskeyCredentialError,
  type PasskeyRepository,
} from '../../repositories/passkeys.ts'

export const createSqlitePasskeyRepository = (db: DB): PasskeyRepository => ({
  async listByUser(userId) {
    return db.select().from(passkeys).where(eq(passkeys.userId, userId)).all()
  },

  async findById(id) {
    return db.select().from(passkeys).where(eq(passkeys.id, id)).get()
  },

  async insert(passkey) {
    try {
      db.insert(passkeys).values(passkey).run()
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicatePasskeyCredentialError()
      throw error
    }
  },

  async delete(id) {
    db.delete(passkeys).where(eq(passkeys.id, id)).run()
  },

  async updateAuthentication(id, expectedCounter, update) {
    const result = db.$client.prepare(`
      UPDATE passkeys
      SET counter = ?, device_type = ?, backed_up = ?, last_used_at = ?
      WHERE id = ? AND counter = ?
    `).run(
      update.counter,
      update.deviceType,
      update.backedUp ? 1 : 0,
      update.lastUsedAt,
      id,
      expectedCounter,
    )
    return Number(result.changes ?? 0) > 0
  },

  async cleanupChallenges(now) {
    db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, now)).run()
  },

  async insertChallenge(challenge) {
    db.insert(webauthnChallenges).values(challenge).run()
  },

  async consumeChallenge(challenge, purpose, now) {
    return db.transaction((tx) => {
      const stored = tx.select().from(webauthnChallenges)
        .where(and(
          eq(webauthnChallenges.challenge, challenge),
          eq(webauthnChallenges.purpose, purpose),
        ))
        .get()
      if (!stored) return null
      tx.delete(webauthnChallenges).where(eq(webauthnChallenges.challenge, challenge)).run()
      return stored.expiresAt < now ? null : stored
    })
  },
})
