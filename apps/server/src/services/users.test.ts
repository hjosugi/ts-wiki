import { describe, expect, test } from 'bun:test'
import type { Principal } from '@kawaii-wiki/core'
import { createDb } from '../db/client.ts'
import { createSqliteUserRepository } from '../db/repositories/users.ts'
import { createUserService } from './users.ts'

describe('user service', () => {
  test('normalizes email, rejects duplicates, and updates profiles', async () => {
    const users = createUserService(createSqliteUserRepository(createDb(':memory:')))
    const created = await users.create({
      email: 'USER@example.COM',
      name: '',
      password: 'password',
      role: 'viewer',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('user create failed')
    expect(created.value.email).toBe('user@example.com')
    expect(created.value.name).toBe('user@example.com')
    expect(await users.count()).toBe(1)

    const duplicate = await users.create({
      email: 'user@example.com',
      name: 'Duplicate',
      password: 'password',
      role: 'viewer',
    })
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error.kind).toBe('conflict')

    const principal: Principal = { id: created.value.id, role: 'viewer' }
    const updated = await users.updateProfile(principal, {
      name: 'Updated Name',
      bio: 'Hello **profile**',
      coverUrl: 'https://example.com/cover.jpg',
      links: [{ label: 'YouTube', url: 'https://youtube.com/@example' }],
      favoritePages: ['Docs/Home', 'docs/home', ''],
    })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.name).toBe('Updated Name')
      expect(updated.value.profileBio).toBe('Hello **profile**')
      expect(updated.value.profileCoverUrl).toBe('https://example.com/cover.jpg')
      expect(JSON.parse(updated.value.profileLinks)).toEqual([{ label: 'YouTube', url: 'https://youtube.com/@example' }])
      expect(JSON.parse(updated.value.profileFavoritePages)).toEqual(['docs/home'])
    }
  })

  test('changes passwords only with the current password and invalidates tokens', async () => {
    const users = createUserService(createSqliteUserRepository(createDb(':memory:')))
    const created = await users.create({
      email: 'password@example.com',
      name: 'Password User',
      password: 'old-password',
      role: 'editor',
    })
    if (!created.ok) throw new Error('user create failed')
    const principal: Principal = { id: created.value.id, role: 'editor' }

    const wrong = await users.changePassword(principal, {
      currentPassword: 'wrong-password',
      newPassword: 'new-password',
    })
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error.kind).toBe('unauthorized')

    const changed = await users.changePassword(principal, {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    })
    expect(changed.ok).toBe(true)
    if (changed.ok) expect(changed.value.tokenInvalidBefore).toBeGreaterThan(0)
  })
})
