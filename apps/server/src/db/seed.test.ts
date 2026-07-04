import { describe, expect, test } from 'bun:test'
import {
  generateSeedAdminPassword,
  resolveSeedAdminPassword,
  SEED_ADMIN_PASSWORD_ENV,
} from './seed.ts'

describe('seed admin password', () => {
  test('uses TS_WIKI_SEED_ADMIN_PASSWORD when configured', () => {
    expect(
      resolveSeedAdminPassword(
        { [SEED_ADMIN_PASSWORD_ENV]: 'correct-horse' },
        () => 'generated-secret',
      ),
    ).toEqual({
      password: 'correct-horse',
      source: 'env',
    })
  })

  test('generates a password when TS_WIKI_SEED_ADMIN_PASSWORD is missing or blank', () => {
    expect(resolveSeedAdminPassword({}, () => 'generated-secret')).toEqual({
      password: 'generated-secret',
      source: 'generated',
    })
    expect(
      resolveSeedAdminPassword(
        { [SEED_ADMIN_PASSWORD_ENV]: '   ' },
        () => 'generated-secret',
      ),
    ).toEqual({
      password: 'generated-secret',
      source: 'generated',
    })
  })

  test('generated passwords are not the old well-known default', () => {
    const first = generateSeedAdminPassword()
    const second = generateSeedAdminPassword()

    expect(first.startsWith('ow-')).toBe(true)
    expect(first.length).toBe(51)
    expect(first).not.toBe('password')
    expect(second).not.toBe(first)
  })
})
