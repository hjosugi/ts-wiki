/**
 * User service — registration and lookup. Returns `Result` for expected
 * failures (duplicate email); throws only on genuinely exceptional states.
 */
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
import {
  DuplicateUserEmailError,
  type UserRecord,
  type UserRepository,
} from '../repositories/users.ts'
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
  count(): Promise<number>
  findById(id: string): Promise<UserRecord | undefined>
  findByEmail(email: string): Promise<UserRecord | undefined>
  updateProfile(principal: Principal | null, input: UpdateUserProfileInput): Promise<Result<UserRecord, AppError>>
  changePassword(
    principal: Principal | null,
    input: { currentPassword: string; newPassword: string },
  ): Promise<Result<UserRecord, AppError>>
  invalidateTokens(userId: string, invalidBefore?: number): Promise<void>
  create(input: CreateUserInput): Promise<Result<UserRecord, AppError>>
}

export const isUserActive = <T extends Pick<UserRecord, 'disabledAt'>>(user: T | null | undefined): user is T =>
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

export const createUserService = (repository: UserRepository): UserService => ({
  async count() {
    return repository.count()
  },

  async findById(id) {
    return repository.findById(id)
  },

  async findByEmail(email) {
    return repository.findByEmail(email.toLowerCase())
  },

  async updateProfile(principal, input) {
    if (!principal) return err(unauthorized())
    const user = await this.findById(principal.id)
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
    await repository.update(user.id, patch)
    return ok({ ...user, ...patch })
  },

  async changePassword(principal, input) {
    if (!principal) return err(unauthorized())
    const user = await this.findById(principal.id)
    if (!user || !isUserActive(user)) return err(unauthorized())
    const invalid = validatePassword(input.newPassword)
    if (invalid) return err(invalid)
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      return err(unauthorized('Current password is incorrect'))
    }
    const passwordHash = await hashPassword(input.newPassword)
    const tokenInvalidBefore = Date.now()
    await repository.update(user.id, { passwordHash, tokenInvalidBefore })
    return ok({ ...user, passwordHash, tokenInvalidBefore })
  },

  async invalidateTokens(userId, invalidBefore = Date.now()) {
    await repository.update(userId, { tokenInvalidBefore: invalidBefore })
  },

  async create(input) {
    const email = input.email.trim().toLowerCase()
    if (await this.findByEmail(email)) return err(conflict('An account with that email already exists'))

    const now = Date.now()
    const user: UserRecord = {
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
      await repository.insert(user)
    } catch (error) {
      if (error instanceof DuplicateUserEmailError) return err(conflict('An account with that email already exists'))
      throw error
    }
    return ok(user)
  },
})
