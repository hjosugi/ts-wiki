export interface TotpRecoveryCodeRecord {
  readonly id: string
  readonly userId: string
  readonly codeHash: string
  readonly createdAt: number
  readonly usedAt: number | null
}

export interface TotpRepository {
  saveSecret(userId: string, secret: string, enabled: number): Promise<void>
  enable(userId: string, recoveryCodes: readonly TotpRecoveryCodeRecord[]): Promise<void>
  replaceRecoveryCodes(userId: string, recoveryCodes: readonly TotpRecoveryCodeRecord[]): Promise<void>
  disable(userId: string): Promise<void>
  listUnusedRecoveryCodes(userId: string): Promise<TotpRecoveryCodeRecord[]>
  consumeRecoveryCode(id: string, usedAt: number): Promise<boolean>
}
