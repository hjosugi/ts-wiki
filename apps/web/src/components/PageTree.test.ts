import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import PageTree from './PageTree.vue'
import type { PageSummary } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const api = vi.hoisted(() => ({
  preferences: vi.fn(),
  updatePreferences: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, Api: { ...actual.Api, ...api } }
})

const page = (
  path: string,
  title: string,
  options: Partial<Pick<PageSummary, 'navOrder' | 'pinned'>> = {},
): PageSummary => ({
  path,
  title,
  description: '',
  lifecycle: 'active',
  status: 'draft',
  labels: '[]',
  ownerId: null,
  reviewAt: null,
  navOrder: options.navOrder ?? null,
  pinned: options.pinned ?? false,
  spaceKey: path.split('/')[0] ?? 'docs',
  locale: 'und',
  updatedAt: 1,
})

const makeRouter = async (): Promise<Router> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return router
}

const installStorage = (): Map<string, string> => {
  const values = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  })
  return values
}

const mountTree = async (pages: PageSummary[], authenticated = false) => {
  const router = await makeRouter()
  const pinia = createPinia()
  setActivePinia(pinia)
  if (authenticated) {
    const auth = useAuth()
    auth.user = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      role: 'viewer',
      totpEnabled: false,
    }
  }
  return mount(PageTree, { props: { pages }, global: { plugins: [pinia, router] } })
}

describe('PageTree', () => {
  beforeEach(() => {
    installStorage()
    api.preferences.mockReset()
    api.updatePreferences.mockReset()
    api.preferences.mockResolvedValue({})
    api.updatePreferences.mockResolvedValue({})
  })

  test('orders pages by shared pinning and nav order when no personal order exists', async () => {
    const wrapper = await mountTree([
      page('docs/z', 'Zed'),
      page('docs/a', 'Alpha', { navOrder: 20 }),
      page('docs/b', 'Beta', { navOrder: 10 }),
      page('docs/pinned', 'Pinned', { pinned: true }),
    ])

    expect(wrapper.findAll('a.page-tree-row').map((link) => link.text())).toEqual([
      'Pinned',
      'Beta',
      'Alpha',
      'Zed',
    ])
  })

  test('loads authenticated nav preferences from the server and syncs local actions back', async () => {
    window.localStorage.setItem('ts-wiki:starred-pages', JSON.stringify(['docs/local']))
    api.preferences.mockResolvedValue({
      'nav:starred': ['docs/server'],
      'nav:collapsed': [],
      'nav:page-order': { 'docs/server': 0, 'docs/local': 1 },
    })

    const wrapper = await mountTree([
      page('docs/local', 'Local'),
      page('docs/server', 'Server'),
    ], true)
    await flushPromises()

    expect(JSON.parse(window.localStorage.getItem('ts-wiki:starred-pages') ?? '[]')).toEqual(['docs/server'])
    expect(wrapper.text()).toContain('Starred')
    expect(wrapper.text()).toContain('Server')

    await wrapper.findAll('button[title="Star page"]')[1]?.trigger('click')
    expect(api.updatePreferences).toHaveBeenCalledWith({ 'nav:starred': ['docs/local', 'docs/server'] })
  })
})
