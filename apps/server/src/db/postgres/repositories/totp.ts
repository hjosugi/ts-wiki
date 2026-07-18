import { and, eq, isNull } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { totpRecoveryCodes, users } from '../schema.ts'
import type { TotpRepository } from '../../../repositories/totp.ts'

type PgTx = Parameters<Parameters<PostgresDb['transaction']>[0]>[0]

const replaceCodes = async (
  tx: PgTx,
  userId: string,
  recoveryCodes: Parameters<TotpRepository['replaceRecoveryCodes']>[1],
): Promise<void> => {
  await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId))
  for (const row of recoveryCodes) await tx.insert(totpRecoveryCodes).values(row)
}

/** PostgreSQL implementation of the driver-neutral TOTP contract. */
export const createPostgresTotpRepository = (db: PostgresDb): TotpRepository => ({
  async saveSecret(userId, secret, enabled) {
    await db.update(users).set({ totpSecret: secret, totpEnabled: enabled }).where(eq(users.id, userId))
  },

  async enable(userId, recoveryCodes) {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ totpEnabled: 1 }).where(eq(users.id, userId))
      await replaceCodes(tx, userId, recoveryCodes)
    })
  },

  async replaceRecoveryCodes(userId, recoveryCodes) {
    await db.transaction(async (tx) => replaceCodes(tx, userId, recoveryCodes))
  },

  async disable(userId) {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ totpSecret: null, totpEnabled: 0 }).where(eq(users.id, userId))
      await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId))
    })
  },

  async listUnusedRecoveryCodes(userId) {
    return db
      .select()
      .from(totpRecoveryCodes)
      .where(and(eq(totpRecoveryCodes.userId, userId), isNull(totpRecoveryCodes.usedAt)))
  },

  async consumeRecoveryCode(id, usedAt) {
    const updated = await db
      .update(totpRecoveryCodes)
      .set({ usedAt })
      .where(and(eq(totpRecoveryCodes.id, id), isNull(totpRecoveryCodes.usedAt)))
      .returning({ id: totpRecoveryCodes.id })
    return updated.length > 0
  },
})
