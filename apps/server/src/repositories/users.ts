import type { Role } from '@kawaii-wiki/core'

/** Driver-neutral user row used by authentication and authorization services. */
export interface UserRecord {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly passwordHash: string
  readonly role: Role
  readonly totpSecret: string | null
  readonly totpEnabled: number
  readonly disabledAt: number | null
  readonly tokenInvalidBefore: number
  readonly emailVerifiedAt: number | null
  readonly profileBio: string
  readonly profileCoverUrl: string
  readonly profileLinks: string
  readonly profileFavoritePages: string
  readonly createdAt: number
}

export type UserPatch = Partial<Omit<UserRecord, 'id' | 'email' | 'createdAt'>>

export class DuplicateUserEmailError extends Error {
  constructor() {
    super('A user with this email already exists')
    this.name = 'DuplicateUserEmailError'
  }
}

export interface UserRepository {
  count(): Promise<number>
  findById(id: string): Promise<UserRecord | undefined>
  findByEmail(email: string): Promise<UserRecord | undefined>
  insert(user: UserRecord): Promise<void>
  update(id: string, patch: UserPatch): Promise<void>
}
