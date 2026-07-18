import { and, eq, lt } from 'drizzle-orm'
import { isUniqueConstraintError } from '../../errors.ts'
import type { PostgresDb } from '../client.ts'
import { passkeys, webauthnChallenges } from '../schema.ts'
import {
  DuplicatePasskeyCredentialError,
  type PasskeyRepository,
} from '../../../repositories/passkeys.ts'

/** PostgreSQL implementation of the driver-neutral passkey contract. */
export const createPostgresPasskeyRepository = (db: PostgresDb): PasskeyRepository => ({
  async listByUser(userId) {
    return db.select().from(passkeys).where(eq(passkeys.userId, userId))
  },

  async findById(id) {
    const [row] = await db.select().from(passkeys).where(eq(passkeys.id, id)).limit(1)
    return row
  },

  async insert(passkey) {
    try {
      await db.insert(passkeys).values(passkey)
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicatePasskeyCredentialError()
      throw error
    }
  },

  async delete(id) {
    await db.delete(passkeys).where(eq(passkeys.id, id))
  },

  async updateAuthentication(id, expectedCounter, update) {
    // Optimistic concurrency: only advance when the stored counter still matches.
    const updated = await db
      .update(passkeys)
      .set({
        counter: update.counter,
        deviceType: update.deviceType,
        backedUp: update.backedUp,
        lastUsedAt: update.lastUsedAt,
      })
      .where(and(eq(passkeys.id, id), eq(passkeys.counter, expectedCounter)))
      .returning({ id: passkeys.id })
    return updated.length > 0
  },

  async cleanupChallenges(now) {
    await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, now))
  },

  async insertChallenge(challenge) {
    await db.insert(webauthnChallenges).values(challenge)
  },

  async consumeChallenge(challenge, purpose, now) {
    return db.transaction(async (tx) => {
      const [stored] = await tx
        .select()
        .from(webauthnChallenges)
        .where(and(
          eq(webauthnChallenges.challenge, challenge),
          eq(webauthnChallenges.purpose, purpose),
        ))
        .limit(1)
      if (!stored) return null
      await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.challenge, challenge))
      return stored.expiresAt < now ? null : stored
    })
  },
})
