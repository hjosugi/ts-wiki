import { describe, expect, test, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createWikiRouter } from './index'
import { Api, setToken } from '@/lib/api'
import { useAuth } from '@/stores/auth'

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
        privateWiki: false,
        registration: 'open',
      })),
    },
  }
})

describe('router auth guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setToken(null)
    vi.mocked(Api.publicSettings).mockResolvedValue({
      siteTitle: 'ts-wiki',
      accentColor: '#7c3aed',
      theme: 'system',
      navLinks: [],
      privateWiki: false,
      registration: 'open',
    })
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

  test('allows editors to open edit routes but keeps admin routes admin-only', async () => {
    const auth = useAuth()
    auth.ready = true
    auth.user = { id: 'u1', email: 'u@example.com', name: 'Editor', role: 'editor', totpEnabled: false }
    const router = createWikiRouter()

    await router.push('/_edit/docs/page')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('edit')

    await router.push('/_admin')
    expect(router.currentRoute.value.name).toBe('login')
  })

  test('redirects anonymous page reads when private wiki is enabled', async () => {
    vi.mocked(Api.publicSettings).mockResolvedValueOnce({
      siteTitle: 'ts-wiki',
      accentColor: '#7c3aed',
      theme: 'system',
      navLinks: [],
      privateWiki: true,
      registration: 'off',
    })
    const router = createWikiRouter()

    await router.push('/docs/private')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/docs/private')
  })
})
