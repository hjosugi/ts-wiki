import type { Role } from '@kawaii-wiki/core'

export interface ApiKeyRecord {
  readonly id: string
  readonly name: string
  readonly keyHash: string
  readonly role: Role
  readonly expiresAt: number | null
  readonly lastUsedAt: number | null
  readonly revokedAt: number | null
  readonly createdAt: number
}

export class DuplicateApiKeyHashError extends Error {
  constructor() {
    super('API key hash already exists')
    this.name = 'DuplicateApiKeyHashError'
  }
}

export interface ApiKeyRepository {
  list(): Promise<ApiKeyRecord[]>
  findById(id: string): Promise<ApiKeyRecord | undefined>
  findByHash(keyHash: string): Promise<ApiKeyRecord | undefined>
  insert(apiKey: ApiKeyRecord): Promise<void>
  revoke(id: string, revokedAt: number): Promise<ApiKeyRecord | undefined>
  markUsedIfActive(id: string, usedAt: number): Promise<boolean>
}
