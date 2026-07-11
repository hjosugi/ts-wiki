import { describe, expect, test } from 'bun:test'
import {
  generateSeedAdminPassword,
  resolveSeedAdminPassword,
  SEED_ADMIN_PASSWORD_ENV,
  LEGACY_SEED_ADMIN_PASSWORD_ENV,
} from './seed.ts'
import { createHomeContent, sampleGuidePages, sampleSeedPages } from '../sample-content.ts'

describe('seed admin password', () => {
  test('uses KAWAII_WIKI_SEED_ADMIN_PASSWORD when configured', () => {
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

  test('prefers the new password name while keeping the legacy alias', () => {
    expect(resolveSeedAdminPassword({
      [LEGACY_SEED_ADMIN_PASSWORD_ENV]: 'legacy-secret',
      [SEED_ADMIN_PASSWORD_ENV]: 'new-secret',
    })).toMatchObject({ password: 'new-secret', source: 'env' })
    expect(resolveSeedAdminPassword({
      [LEGACY_SEED_ADMIN_PASSWORD_ENV]: 'legacy-secret',
    })).toMatchObject({ password: 'legacy-secret', source: 'env' })
  })

  test('generates a password when the seed password is missing or blank', () => {
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

describe('sample guide content', () => {
  test('ships compact English and Japanese guides for non-engineers', () => {
    expect(sampleGuidePages.map((page) => [page.path, page.locale])).toEqual([
      ['help/en/basic-editing', 'en'],
      ['help/ja/basic-editing', 'ja'],
    ])

    const allContent = sampleGuidePages.map((page) => page.content).join('\n')
    expect(allContent).toContain('[[home]]')
    expect(allContent).toContain('/assets/example-screenshot.png')
    expect(allContent).toContain('```callout')
    expect(allContent).toContain('/_templates')
    expect(allContent).toContain('Edit')
    expect(allContent).toContain('テンプレート')

    for (const page of sampleGuidePages) {
      expect(page.status).toBe('verified')
      expect(page.labels).toContain('guide')
      expect(page.content.length).toBeLessThan(1800)
    }
  })

  test('seed pages include a home page that links to both guide locales', () => {
    const pages = sampleSeedPages()

    expect(pages.map((page) => page.path)).toEqual([
      'home',
      'help/en/basic-editing',
      'help/ja/basic-editing',
    ])
    expect(pages[0]).toMatchObject({
      path: 'home',
      title: 'kawaii-wiki.ts',
      pinned: true,
      navOrder: 0,
    })
    expect(pages[0]!.content).toContain('/help/en/basic-editing')
    expect(pages[0]!.content).toContain('/help/ja/basic-editing')
  })

  test('setup home content only links guides when sample content is enabled', () => {
    expect(createHomeContent('Team Wiki')).not.toContain('/help/en/basic-editing')
    expect(createHomeContent('Team Wiki', { includeGuideLinks: true })).toContain('/help/en/basic-editing')
  })
})
