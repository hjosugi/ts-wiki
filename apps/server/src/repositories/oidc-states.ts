export interface OidcStateRecord {
  readonly state: string
  readonly provider: string
  readonly nonce: string
  readonly codeVerifier: string
  readonly redirectAfter: string | null
  readonly expiresAt: number
  readonly createdAt: number
}

export interface OidcStateRepository {
  cleanupExpired(now: number): Promise<void>
  insert(state: OidcStateRecord): Promise<void>
  consume(state: string, provider: string, now: number): Promise<OidcStateRecord | null>
}
