import { err, ok, type AppError, type Result, unauthorized } from '@kawaii-wiki/core'
import type { TotpRecoveryCodeRecord, TotpRepository } from '../repositories/totp.ts'
import type { UserRecord } from '../repositories/users.ts'
import {
  hashRecoveryCode,
  otpauthUrl,
  randomBase32Secret,
  randomRecoveryCode,
  verifyRecoveryCode,
  verifyTotpCode,
} from './auth.ts'

const RECOVERY_CODE_COUNT = 8

export interface TotpService {
  setup(user: UserRecord): Promise<Result<{ secret: string; otpauthUrl: string }, AppError>>
  enable(user: UserRecord, code: string): Promise<Result<{ user: UserRecord; recoveryCodes: string[] }, AppError>>
  regenerate(user: UserRecord, code: string): Promise<Result<string[], AppError>>
  disable(user: UserRecord, code?: string): Promise<Result<UserRecord, AppError>>
  consumeRecoveryCode(userId: string, code: string): Promise<boolean>
}

export const createTotpService = (repository: TotpRepository, siteName: string): TotpService => {
  const recoveryCodeSet = async (userId: string): Promise<{ plain: string[]; rows: TotpRecoveryCodeRecord[] }> => {
    const createdAt = Date.now()
    const codeSet = new Set<string>()
    while (codeSet.size < RECOVERY_CODE_COUNT) codeSet.add(randomRecoveryCode())
    const plain = [...codeSet]
    const rows = await Promise.all(plain.map(async (code) => ({
      id: crypto.randomUUID(),
      userId,
      codeHash: await hashRecoveryCode(code),
      createdAt,
      usedAt: null,
    })))
    return { plain, rows }
  }

  return {
    async setup(user) {
      const secret = user.totpSecret || randomBase32Secret()
      await repository.saveSecret(user.id, secret, user.totpEnabled)
      return ok({ secret, otpauthUrl: otpauthUrl(siteName, user.email, secret) })
    },

    async enable(user, code) {
      if (!user.totpSecret || !verifyTotpCode(user.totpSecret, code)) {
        return err(unauthorized('Invalid two-factor code'))
      }
      const recoveryCodes = await recoveryCodeSet(user.id)
      await repository.enable(user.id, recoveryCodes.rows)
      return ok({ user: { ...user, totpEnabled: 1 }, recoveryCodes: recoveryCodes.plain })
    },

    async regenerate(user, code) {
      if (!user.totpEnabled || !user.totpSecret || !verifyTotpCode(user.totpSecret, code)) {
        return err(unauthorized('Invalid two-factor code'))
      }
      const recoveryCodes = await recoveryCodeSet(user.id)
      await repository.replaceRecoveryCodes(user.id, recoveryCodes.rows)
      return ok(recoveryCodes.plain)
    },

    async disable(user, code) {
      if (user.totpEnabled && (!user.totpSecret || !code || !verifyTotpCode(user.totpSecret, code))) {
        return err(unauthorized('Invalid two-factor code'))
      }
      await repository.disable(user.id)
      return ok({ ...user, totpSecret: null, totpEnabled: 0 })
    },

    async consumeRecoveryCode(userId, code) {
      const rows = await repository.listUnusedRecoveryCodes(userId)
      for (const row of rows) {
        if (!await verifyRecoveryCode(code, row.codeHash)) continue
        if (await repository.consumeRecoveryCode(row.id, Date.now())) return true
      }
      return false
    },
  }
}
