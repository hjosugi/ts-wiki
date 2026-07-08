import { and, eq } from 'drizzle-orm'
import {
  type AppError,
  type Principal,
  type Result,
  err,
  ok,
  unauthorized,
  validationError,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { userPreferences } from '../db/schema.ts'

export type UserPreferenceKey = 'nav:collapsed' | 'nav:starred' | 'nav:page-order'
export type UserPreferenceMap = Record<UserPreferenceKey, unknown>

export interface UserPreferenceService {
  get(principal: Principal | null): Result<Partial<UserPreferenceMap>, AppError>
  update(principal: Principal | null, preferences: unknown): Result<Partial<UserPreferenceMap>, AppError>
}

const ALLOWED_KEYS = new Set<UserPreferenceKey>(['nav:collapsed', 'nav:starred', 'nav:page-order'])
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

const cleanPreference = (key: UserPreferenceKey, value: unknown): Result<unknown | null, AppError> => {
  if (value === null) return ok(null)
  const cleaned = key === 'nav:page-order' ? pageOrder(value) : uniqueStrings(value)
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

export const createUserPreferenceService = (db: DB): UserPreferenceService => {
  const requireUser = (principal: Principal | null): Result<Principal, AppError> =>
    principal ? ok(principal) : err(unauthorized())

  const getForUser = (userId: string): Partial<UserPreferenceMap> => {
    const preferences: Partial<UserPreferenceMap> = {}
    for (const row of db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).all()) {
      const value = parseStored(row.key, row.value)
      if (value !== undefined && isPreferenceKey(row.key)) preferences[row.key] = value
    }
    return preferences
  }

  return {
    get(principal) {
      const user = requireUser(principal)
      if (!user.ok) return user
      return ok(getForUser(user.value.id))
    },

    update(principal, preferences) {
      const user = requireUser(principal)
      if (!user.ok) return user
      if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
        return err(validationError('Preferences must be an object', 'preferences'))
      }

      const now = Date.now()
      for (const [key, value] of Object.entries(preferences as Record<string, unknown>)) {
        if (!isPreferenceKey(key)) return err(validationError(`Unknown preference key: ${key}`, key))
        const cleaned = cleanPreference(key, value)
        if (!cleaned.ok) return cleaned
        if (cleaned.value === null) {
          db.delete(userPreferences)
            .where(and(eq(userPreferences.userId, user.value.id), eq(userPreferences.key, key)))
            .run()
          continue
        }
        const encoded = JSON.stringify(cleaned.value)
        db.insert(userPreferences)
          .values({ userId: user.value.id, key, value: encoded, updatedAt: now })
          .onConflictDoUpdate({
            target: [userPreferences.userId, userPreferences.key],
            set: { value: encoded, updatedAt: now },
          })
          .run()
      }

      return ok(getForUser(user.value.id))
    },
  }
}
