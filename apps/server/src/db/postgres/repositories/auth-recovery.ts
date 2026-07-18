import { eq, lte } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { emailVerifications, passwordResets, users } from '../schema.ts'
import type {
  AuthRecoveryRepository,
  EmailVerificationRecord,
  PasswordResetRecord,
} from '../../../repositories/auth-recovery.ts'

/** PostgreSQL implementation of the driver-neutral auth-recovery contract. */
export const createPostgresAuthRecoveryRepository = (db: PostgresDb): AuthRecoveryRepository => ({
  async cleanupExpired(cutoff) {
    await db.transaction(async (tx) => {
      await tx.delete(passwordResets).where(lte(passwordResets.expiresAt, cutoff))
      await tx.delete(emailVerifications).where(lte(emailVerifications.expiresAt, cutoff))
    })
  },

  async findUserByEmail(email) {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    return row
  },

  async replacePasswordReset(record: PasswordResetRecord) {
    await db.transaction(async (tx) => {
      await tx.delete(passwordResets).where(eq(passwordResets.userId, record.userId))
      await tx.insert(passwordResets).values(record)
    })
  },

  async consumePasswordReset(token, now, passwordHash, tokenInvalidBefore) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(passwordResets).where(eq(passwordResets.token, token)).limit(1)
      if (!row || row.expiresAt <= now) return null
      const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1)
      if (!user || user.disabledAt !== null) return null
      await tx
        .update(users)
        .set({
          passwordHash,
          tokenInvalidBefore,
          emailVerifiedAt: user.emailVerifiedAt ?? tokenInvalidBefore,
        })
        .where(eq(users.id, user.id))
      await tx.delete(passwordResets).where(eq(passwordResets.userId, user.id))
      return user.id
    })
  },

  async replaceEmailVerification(record: EmailVerificationRecord) {
    await db.transaction(async (tx) => {
      await tx.delete(emailVerifications).where(eq(emailVerifications.userId, record.userId))
      await tx.insert(emailVerifications).values(record)
    })
  },

  async consumeEmailVerification(token, now) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(emailVerifications).where(eq(emailVerifications.token, token)).limit(1)
      if (!row || row.expiresAt <= now) return null
      const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1)
      if (!user || user.disabledAt !== null || user.email !== row.email) return null
      await tx.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, user.id))
      await tx.delete(emailVerifications).where(eq(emailVerifications.userId, user.id))
      return user.id
    })
  },
})
