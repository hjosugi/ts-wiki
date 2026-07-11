import { createHash, randomBytes } from 'node:crypto'
import {
  type AppError,
  type Principal,
  type Result,
  type Role,
  err,
  notFound,
  ok,
  requirePermission,
  validationError,
} from '@kawaii-wiki/core'
import type { ApiKeyRecord, ApiKeyRepository } from '../repositories/api-keys.ts'
import type { AuthzService } from './authz.ts'

export const API_KEY_PREFIX = 'tswk_'

export interface ApiKeyView {
  readonly id: string
  readonly name: string
  readonly role: Role
  readonly expiresAt: number | null
  readonly lastUsedAt: number | null
  readonly revokedAt: number | null
  readonly createdAt: number
}

export interface CreatedApiKey {
  readonly apiKey: ApiKeyView
  readonly secret: string
}

export interface CreateApiKeyInput {
  readonly name: string
  readonly role?: Role
  readonly expiresAt?: number | null
}

export interface ApiKeyService {
  list(principal: Principal | null): Promise<Result<ApiKeyView[], AppError>>
  create(principal: Principal | null, input: CreateApiKeyInput): Promise<Result<CreatedApiKey, AppError>>
  revoke(principal: Principal | null, id: string): Promise<Result<ApiKeyView, AppError>>
  resolve(secret: string | null | undefined): Promise<Principal | null>
}

const ROLES: readonly Role[] = ['admin', 'editor', 'viewer']

const hashApiKey = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex')

const generateSecret = (): string =>
  `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`

const toView = (row: ApiKeyRecord): ApiKeyView => ({
  id: row.id,
  name: row.name,
  role: row.role,
  expiresAt: row.expiresAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
  createdAt: row.createdAt,
})

export const createApiKeyService = (repository: ApiKeyRepository, authz: AuthzService): ApiKeyService => {
  const uniqueSecret = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const secret = generateSecret()
      if (!await repository.findByHash(hashApiKey(secret))) return secret
    }
    return `${API_KEY_PREFIX}${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
  }

  return {
    async list(principal) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      return ok((await repository.list()).map(toView))
    },

    async create(principal, input) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed

      const name = input.name.trim()
      if (!name) return err(validationError('API key name is required', 'name'))
      if (name.length > 100) return err(validationError('API key name must be 100 characters or fewer', 'name'))

      const role = input.role ?? 'viewer'
      if (!ROLES.includes(role)) return err(validationError('Unknown API key role', 'role'))

      const expiresAt = input.expiresAt ?? null
      if (expiresAt !== null) {
        if (!Number.isFinite(expiresAt)) return err(validationError('Expiration must be a timestamp', 'expiresAt'))
        if (Math.trunc(expiresAt) <= Date.now()) {
          return err(validationError('Expiration must be in the future', 'expiresAt'))
        }
      }

      const secret = await uniqueSecret()
      const now = Date.now()
      const row: ApiKeyRecord = {
        id: crypto.randomUUID(),
        name,
        keyHash: hashApiKey(secret),
        role,
        expiresAt: expiresAt === null ? null : Math.trunc(expiresAt),
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
      }
      await repository.insert(row)
      return ok({ apiKey: toView(row), secret })
    },

    async revoke(principal, id) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const row = await repository.revoke(id, Date.now())
      if (!row) return err(notFound('API key not found'))
      return ok(toView(row))
    },

    async resolve(secret) {
      if (!secret?.startsWith(API_KEY_PREFIX)) return null
      const row = await repository.findByHash(hashApiKey(secret))
      const now = Date.now()
      if (!row || row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= now)) {
        return null
      }
      if (!await repository.markUsedIfActive(row.id, now)) return null
      return authz.principalForApiKey(row.id, row.role)
    },
  }
}
