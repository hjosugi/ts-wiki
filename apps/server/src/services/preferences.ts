import {
  type AppError,
  type Principal,
  type Result,
  err,
  ok,
  unauthorized,
  validationError,
} from '@kawaii-wiki/core'
import type {
  UserPreferenceMutation,
  UserPreferenceRepository,
} from '../repositories/user-preferences.ts'

export type UserPreferenceKey = 'nav:collapsed' | 'nav:starred' | 'nav:page-order' | 'editor:mode'
export type UserPreferenceMap = Record<UserPreferenceKey, unknown>

export interface UserPreferenceService {
  get(principal: Principal | null): Promise<Result<Partial<UserPreferenceMap>, AppError>>
  update(principal: Principal | null, preferences: unknown): Promise<Result<Partial<UserPreferenceMap>, AppError>>
}

const ALLOWED_KEYS = new Set<UserPreferenceKey>(['nav:collapsed', 'nav:starred', 'nav:page-order', 'editor:mode'])
const MAX_ENTRIES = 500
const MAX_VALUE_LENGTH = 20_000

const isPreferenceKey = (key: string): key is UserPreferenceKey =>
  ALLOWED_KEYS.has(key as UserPreferenceKey)

const uniqueStrings = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const clean = item.trim().slice(0, 512)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}

const pageOrder = (value: unknown): Record<string, number> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, number> = {}
  for (const [path, order] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
    if (typeof order !== 'number' || !Number.isFinite(order)) return null
    const cleanPath = path.trim().slice(0, 512)
    if (!cleanPath) continue
    out[cleanPath] = Math.max(-MAX_ENTRIES, Math.min(MAX_ENTRIES, Math.trunc(order)))
  }
  return out
}

const editorMode = (value: unknown): 'markdown' | 'visual' | null =>
  value === 'markdown' || value === 'visual' ? value : null

const cleanPreference = (key: UserPreferenceKey, value: unknown): Result<unknown | null, AppError> => {
  if (value === null) return ok(null)
  const cleaned = key === 'nav:page-order'
    ? pageOrder(value)
    : key === 'editor:mode'
      ? editorMode(value)
      : uniqueStrings(value)
  if (cleaned === null) return err(validationError(`Invalid preference value for ${key}`, key))
  const encoded = JSON.stringify(cleaned)
  if (encoded.length > MAX_VALUE_LENGTH) return err(validationError(`Preference ${key} is too large`, key))
  return ok(cleaned)
}

const parseStored = (key: string, value: string): unknown | undefined => {
  if (!isPreferenceKey(key)) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    const cleaned = cleanPreference(key, parsed)
    return cleaned.ok ? cleaned.value : undefined
  } catch {
    return undefined
  }
}

export const createUserPreferenceService = (repository: UserPreferenceRepository): UserPreferenceService => {
  const requireUser = (principal: Principal | null): Result<Principal, AppError> =>
    principal ? ok(principal) : err(unauthorized())

  const getForUser = async (userId: string): Promise<Partial<UserPreferenceMap>> => {
    const preferences: Partial<UserPreferenceMap> = {}
    for (const row of await repository.listForUser(userId)) {
      const value = parseStored(row.key, row.value)
      if (value !== undefined && isPreferenceKey(row.key)) preferences[row.key] = value
    }
    return preferences
  }

  return {
    async get(principal) {
      const user = requireUser(principal)
      if (!user.ok) return user
      return ok(await getForUser(user.value.id))
    },

    async update(principal, preferences) {
      const user = requireUser(principal)
      if (!user.ok) return user
      if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
        return err(validationError('Preferences must be an object', 'preferences'))
      }

      const now = Date.now()
      const mutations: UserPreferenceMutation[] = []
      for (const [key, value] of Object.entries(preferences as Record<string, unknown>)) {
        if (!isPreferenceKey(key)) return err(validationError(`Unknown preference key: ${key}`, key))
        const cleaned = cleanPreference(key, value)
        if (!cleaned.ok) return cleaned
        mutations.push({
          key,
          value: cleaned.value === null ? null : JSON.stringify(cleaned.value),
        })
      }

      await repository.applyForUser(user.value.id, mutations, now)
      return ok(await getForUser(user.value.id))
    },
  }
}
