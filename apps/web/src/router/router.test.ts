import { describe, expect, test, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createWikiRouter } from './index'
import { Api, setToken } from '@/lib/api'
import type { PublicSettings } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const makePublicSettings = (overrides: Partial<PublicSettings> = {}): PublicSettings => ({
  siteTitle: 'ts-wiki',
  accentColor: '#7c3aed',
  theme: 'system',
  navLinks: [],
  logoUrl: '',
  faviconUrl: '',
  footerText: '',
  footerLinks: [],
  customCss: '',
  customHeadHtml: '',
  enableMath: false,
  enableEmoji: true,
  enableMermaid: false,
  privateWiki: false,
  registration: 'open',
  mailConfigured: false,
  requireEmailVerification: false,
  requireTwoFactor: false,
  ...overrides,
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    Api: {
      ...actual.Api,
      publicSettings: vi.fn(async () => ({
        siteTitle: 'ts-wiki',
        accentColor: '#7c3aed',
        theme: 'system',
        navLinks: [],
        logoUrl: '',
        faviconUrl: '',
        footerText: '',
        footerLinks: [],
        customCss: '',
        customHeadHtml: '',
        enableMath: false,
        enableEmoji: true,
        enableMermaid: false,
        privateWiki: false,
        registration: 'open',
        mailConfigured: false,
        requireEmailVerification: false,
        requireTwoFactor: false,
      })),
    },
  }
})

describe('router auth guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setToken(null)
    vi.mocked(Api.publicSettings).mockResolvedValue(makePublicSettings())
  })

  test('redirects anonymous editors/admins to login', async () => {
    const router = createWikiRouter()

    await router.push('/_new')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/_new')

    await router.push('/_admin')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/_admin')
  })

  test('allows editors to open edit/template routes but keeps admin routes admin-only', async () => {
    const auth = useAuth()
    auth.ready = true
    auth.user = { id: 'u1', email: 'u@example.com', name: 'Editor', role: 'editor', totpEnabled: false }
    const router = createWikiRouter()

    await router.push('/_edit/docs/page')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('edit')

    await router.push('/_templates')
    expect(router.currentRoute.value.name).toBe('templates')

    await router.push('/_admin')
    expect(router.currentRoute.value.name).toBe('login')
  })

  test('redirects anonymous page reads when private wiki is enabled', async () => {
    vi.mocked(Api.publicSettings).mockResolvedValueOnce(makePublicSettings({
      privateWiki: true,
      registration: 'off',
    }))
    const router = createWikiRouter()

    await router.push('/docs/private')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/docs/private')
  })

  test('allows anonymous shared links when private wiki is enabled', async () => {
    vi.mocked(Api.publicSettings).mockResolvedValueOnce(makePublicSettings({
      privateWiki: true,
      registration: 'off',
    }))
    const router = createWikiRouter()

    await router.push('/_share/share-token')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('shared')
  })

  test('allows anonymous password reset and email verification links when private wiki is enabled', async () => {
    vi.mocked(Api.publicSettings).mockResolvedValueOnce(makePublicSettings({
      privateWiki: true,
      registration: 'off',
      mailConfigured: true,
      requireEmailVerification: true,
      requireTwoFactor: true,
    }))
    const router = createWikiRouter()

    await router.push('/_reset?token=abc')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('reset-password')

    await router.push('/_verify-email?token=abc')
    expect(router.currentRoute.value.name).toBe('verify-email')
  })
})
