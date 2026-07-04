import { describe, expect, test, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createWikiRouter } from './index'
import { setToken } from '@/lib/api'
import { useAuth } from '@/stores/auth'

describe('router auth guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setToken(null)
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
})
