export type WebauthnChallengePurpose = 'registration' | 'authentication'

export interface PasskeyRecord {
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly publicKey: string
  readonly counter: number
  readonly transports: string
  readonly deviceType: string
  readonly backedUp: boolean
  readonly createdAt: number
  readonly lastUsedAt: number | null
}

export interface WebauthnChallengeRecord {
  readonly challenge: string
  readonly userId: string | null
  readonly purpose: WebauthnChallengePurpose
  readonly expiresAt: number
  readonly createdAt: number
}

export interface PasskeyAuthenticationUpdate {
  readonly counter: number
  readonly deviceType: string
  readonly backedUp: boolean
  readonly lastUsedAt: number
}

export class DuplicatePasskeyCredentialError extends Error {
  constructor() {
    super('Passkey credential already exists')
    this.name = 'DuplicatePasskeyCredentialError'
  }
}

export interface PasskeyRepository {
  listByUser(userId: string): Promise<PasskeyRecord[]>
  findById(id: string): Promise<PasskeyRecord | undefined>
  insert(passkey: PasskeyRecord): Promise<void>
  delete(id: string): Promise<void>
  updateAuthentication(id: string, expectedCounter: number, update: PasskeyAuthenticationUpdate): Promise<boolean>
  cleanupChallenges(now: number): Promise<void>
  insertChallenge(challenge: WebauthnChallengeRecord): Promise<void>
  consumeChallenge(
    challenge: string,
    purpose: WebauthnChallengePurpose,
    now: number,
  ): Promise<WebauthnChallengeRecord | null>
}
