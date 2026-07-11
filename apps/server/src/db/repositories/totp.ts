import { and, eq, isNull } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { totpRecoveryCodes, users } from '../schema.ts'
import type { TotpRepository } from '../../repositories/totp.ts'

const replaceCodes = (
  tx: Parameters<Parameters<DB['transaction']>[0]>[0],
  userId: string,
  recoveryCodes: Parameters<TotpRepository['replaceRecoveryCodes']>[1],
): void => {
  tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId)).run()
  for (const row of recoveryCodes) tx.insert(totpRecoveryCodes).values(row).run()
}

export const createSqliteTotpRepository = (db: DB): TotpRepository => ({
  async saveSecret(userId, secret, enabled) {
    db.update(users).set({ totpSecret: secret, totpEnabled: enabled }).where(eq(users.id, userId)).run()
  },

  async enable(userId, recoveryCodes) {
    db.transaction((tx) => {
      tx.update(users).set({ totpEnabled: 1 }).where(eq(users.id, userId)).run()
      replaceCodes(tx, userId, recoveryCodes)
    })
  },

  async replaceRecoveryCodes(userId, recoveryCodes) {
    db.transaction((tx) => replaceCodes(tx, userId, recoveryCodes))
  },

  async disable(userId) {
    db.transaction((tx) => {
      tx.update(users).set({ totpSecret: null, totpEnabled: 0 }).where(eq(users.id, userId)).run()
      tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId)).run()
    })
  },

  async listUnusedRecoveryCodes(userId) {
    return db.select().from(totpRecoveryCodes)
      .where(and(eq(totpRecoveryCodes.userId, userId), isNull(totpRecoveryCodes.usedAt)))
      .all()
  },

  async consumeRecoveryCode(id, usedAt) {
    const result = db.$client
      .prepare('UPDATE totp_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .run(usedAt, id)
    return Number(result.changes ?? 0) > 0
  },
})
