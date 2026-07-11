/**
 * User service — registration and lookup. Returns `Result` for expected
 * failures (duplicate email); throws only on genuinely exceptional states.
 */
import { eq, sql } from 'drizzle-orm'
import {
  type Result,
  ok,
  err,
  conflict,
  type AppError,
  type Role,
  type Principal,
  unauthorized,
  validationError,
  normalizePath,
} from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import { isUniqueConstraintError } from '../db/errors.ts'
import { users, type User } from '../db/schema.ts'
import { hashPassword, verifyPassword } from './auth.ts'

export interface CreateUserInput {
  readonly email: string
  readonly name: string
  readonly password: string
  readonly role: Role
  readonly emailVerifiedAt?: number | null
}

export interface ProfileLink {
  readonly label: string
  readonly url: string
}

export interface UpdateUserProfileInput {
  readonly name?: string
  readonly bio?: string
  readonly coverUrl?: string
  readonly links?: readonly ProfileLink[]
  readonly favoritePages?: readonly string[]
}

export interface UserService {
  count(): number
  findById(id: string): User | undefined
  findByEmail(email: string): User | undefined
  updateProfile(principal: Principal | null, input: UpdateUserProfileInput): Result<User, AppError>
  changePassword(
    principal: Principal | null,
    input: { currentPassword: string; newPassword: string },
  ): Promise<Result<User, AppError>>
  invalidateTokens(userId: string, invalidBefore?: number): void
  create(input: CreateUserInput): Promise<Result<User, AppError>>
}

export const isUserActive = <T extends Pick<User, 'disabledAt'>>(user: T | null | undefined): user is T =>
  Boolean(user && user.disabledAt === null)

const cleanName = (value: string | undefined, fallback: string): string => value?.trim() || fallback

const validatePassword = (password: string): AppError | null =>
  password.length >= 6 ? null : validationError('Password must be at least 6 characters', 'password')

const cleanProfileUrl = (value: string | undefined, field: string): Result<string, AppError> => {
  const clean = value?.trim() ?? ''
  if (!clean) return ok('')
  if (clean.startsWith('/')) return ok(clean.slice(0, 500))
  try {
    const url = new URL(clean)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return err(validationError('Profile URL must use http or https', field))
    }
    return ok(url.toString().slice(0, 500))
  } catch {
    return err(validationError('Profile URL is invalid', field))
  }
}

const cleanProfileLinks = (links: readonly ProfileLink[] | undefined): Result<ProfileLink[] | undefined, AppError> => {
  if (links === undefined) return ok(undefined)
  if (!Array.isArray(links)) return err(validationError('Links must be an array', 'links'))
  const out: ProfileLink[] = []
  for (const [index, link] of links.entries()) {
    if (!link || typeof link !== 'object') return err(validationError('Link is invalid', `links.${index}`))
    const url = cleanProfileUrl(link.url, `links.${index}.url`)
    if (!url.ok) return url
    if (!url.value) continue
    const label = String(link.label ?? '').trim().slice(0, 80) || new URL(url.value, 'https://example.invalid').hostname
    out.push({ label, url: url.value })
    if (out.length >= 12) break
  }
  return ok(out)
}

const cleanFavoritePages = (paths: readonly string[] | undefined): Result<string[] | undefined, AppError> => {
  if (paths === undefined) return ok(undefined)
  if (!Array.isArray(paths)) return err(validationError('Favorite pages must be an array', 'favoritePages'))
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of paths) {
    const path = normalizePath(String(raw ?? ''))
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push(path)
    if (out.length >= 12) break
  }
  return ok(out)
}

export const createUserService = (db: DB): UserService => ({
  count() {
    const row = db.select({ c: sql<number>`count(*)` }).from(users).get()
    return row?.c ?? 0
  },

  findById(id) {
    return db.select().from(users).where(eq(users.id, id)).get()
  },

  findByEmail(email) {
    return db.select().from(users).where(eq(users.email, email.toLowerCase())).get()
  },

  updateProfile(principal, input) {
    if (!principal) return err(unauthorized())
    const user = this.findById(principal.id)
    if (!user || !isUserActive(user)) return err(unauthorized())
    const name = cleanName(input.name, user.name)
    const coverUrl = cleanProfileUrl(input.coverUrl, 'coverUrl')
    if (!coverUrl.ok) return coverUrl
    const links = cleanProfileLinks(input.links)
    if (!links.ok) return links
    const favoritePages = cleanFavoritePages(input.favoritePages)
    if (!favoritePages.ok) return favoritePages
    const patch = {
      name,
      ...(input.bio !== undefined ? { profileBio: input.bio.trim().slice(0, 2000) } : {}),
      ...(input.coverUrl !== undefined ? { profileCoverUrl: coverUrl.value } : {}),
      ...(links.value !== undefined ? { profileLinks: JSON.stringify(links.value) } : {}),
      ...(favoritePages.value !== undefined ? { profileFavoritePages: JSON.stringify(favoritePages.value) } : {}),
    }
    db.update(users).set(patch).where(eq(users.id, user.id)).run()
    return ok({ ...user, ...patch })
  },

  async changePassword(principal, input) {
    if (!principal) return err(unauthorized())
    const user = this.findById(principal.id)
    if (!user || !isUserActive(user)) return err(unauthorized())
    const invalid = validatePassword(input.newPassword)
    if (invalid) return err(invalid)
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      return err(unauthorized('Current password is incorrect'))
    }
    const passwordHash = await hashPassword(input.newPassword)
    const tokenInvalidBefore = Date.now()
    db.update(users).set({ passwordHash, tokenInvalidBefore }).where(eq(users.id, user.id)).run()
    return ok({ ...user, passwordHash, tokenInvalidBefore })
  },

  invalidateTokens(userId, invalidBefore = Date.now()) {
    db.update(users).set({ tokenInvalidBefore: invalidBefore }).where(eq(users.id, userId)).run()
  },

  async create(input) {
    const email = input.email.trim().toLowerCase()
    if (this.findByEmail(email)) return err(conflict('An account with that email already exists'))

    const now = Date.now()
    const user: User = {
      id: crypto.randomUUID(),
      email,
      name: input.name.trim() || email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      totpSecret: null,
      totpEnabled: 0,
      disabledAt: null,
      tokenInvalidBefore: 0,
      emailVerifiedAt: input.emailVerifiedAt === undefined ? now : input.emailVerifiedAt,
      profileBio: '',
      profileCoverUrl: '',
      profileLinks: '[]',
      profileFavoritePages: '[]',
      createdAt: now,
    }
    try {
      db.insert(users).values(user).run()
    } catch (error) {
      if (isUniqueConstraintError(error)) return err(conflict('An account with that email already exists'))
      throw error
    }
    return ok(user)
  },
})
