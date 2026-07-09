import { DOMWrapper, mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import CommandPalette from './CommandPalette.vue'
import type { PageSummary, SearchHit } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const api = vi.hoisted(() => ({
  search: vi.fn(),
  listPages: vi.fn(),
  publicSettings: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, Api: { ...actual.Api, ...api } }
})

const page = (path: string, title = path): PageSummary => ({
  path,
  title,
  description: '',
  icon: '',
  coverUrl: '',
  coverPosition: 'center',
  lifecycle: 'active',
  status: 'draft',
  labels: '[]',
  ownerId: null,
  authorId: null,
  reviewAt: null,
  navOrder: null,
  pinned: false,
  spaceKey: 'docs',
  locale: 'und',
  updatedAt: 1,
})

const hit = (path: string, title = path): SearchHit => ({
  path,
  title,
  icon: '',
  coverUrl: '',
  coverPosition: 'center',
  snippet: '<mark>alpha</mark>',
  rank: 0,
  kind: 'page',
  updatedAt: 1,
})

const makeRouter = async (): Promise<Router> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/_new', name: 'new', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return router
}

const settle = async (): Promise<void> => {
  await flushPromises()
  await Promise.resolve()
}

const installStorage = (): void => {
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
}

describe('CommandPalette', () => {
  const wrappers: VueWrapper[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    installStorage()
    api.search.mockReset()
    api.listPages.mockResolvedValue([page('docs/local', 'Local page')])
    api.publicSettings.mockReset()
    api.publicSettings.mockResolvedValue({ dailyNotesPath: 'journal', timezone: 'UTC' })
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    vi.useRealTimers()
  })

  const mountPalette = (router: Router, pinia = createPinia()): VueWrapper => {
    const wrapper = mount(CommandPalette, {
      attachTo: document.body,
      global: { plugins: [pinia, router] },
    })
    wrappers.push(wrapper)
    return wrapper
  }

  const paletteInput = (): DOMWrapper<HTMLInputElement> => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Search or jump..."]')
    expect(input).not.toBeNull()
    return new DOMWrapper(input!)
  }

  test('opens from the keyboard shortcut and searches through the shared composable', async () => {
    api.search.mockResolvedValue({ query: 'alpha', hits: [hit('docs/alpha', 'Alpha')], total: 1, limit: 8, offset: 0, hasMore: false })
    const router = await makeRouter()
    mountPalette(router)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await settle()
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Command palette')
    expect(document.querySelector('[role="combobox"]')?.getAttribute('aria-controls')).toBe('command-palette-results')
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()

    await paletteInput().setValue('alpha')
    await vi.advanceTimersByTimeAsync(140)
    await settle()

    expect(api.search).toHaveBeenCalledWith('alpha', expect.objectContaining({ limit: 8, scope: 'title' }))
    expect(document.body.textContent).toContain('Alpha')
    expect(document.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('true')
  })

  test('shows recent searches and lets keyboard selection open a result', async () => {
    window.localStorage.setItem('ts-wiki-recent-searches', JSON.stringify(['banana']))
    api.search.mockResolvedValue({
      query: 'banana',
      hits: [hit('docs/banana', 'Banana')],
      total: 1,
      limit: 8,
      offset: 0,
      hasMore: false,
    })
    const router = await makeRouter()
    mountPalette(router)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await settle()
    expect(document.body.textContent).toContain('banana')

    const recent = document.querySelector<HTMLButtonElement>('button.rounded-full')
    expect(recent).not.toBeNull()
    await new DOMWrapper(recent!).trigger('click')
    await vi.advanceTimersByTimeAsync(140)
    await settle()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await settle()

    expect(router.currentRoute.value.path).toBe('/docs/banana')
  })

  test('offers a daily note command that creates the configured journal page', async () => {
    vi.setSystemTime(new Date('2026-07-10T03:00:00Z'))
    api.publicSettings.mockResolvedValue({ dailyNotesPath: 'daily/notes', timezone: 'UTC' })
    const router = await makeRouter()
    const pinia = createPinia()
    mountPalette(router, pinia)
    const auth = useAuth(pinia)
    auth.user = {
      id: 'editor-1',
      email: 'editor@example.com',
      name: 'Editor',
      role: 'editor',
      totpEnabled: false,
      profileBio: '',
      profileCoverUrl: '',
      profileLinks: [],
      profileFavoritePages: [],
    }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await settle()
    expect(document.body.textContent).toContain("Today's note")
    expect(document.body.textContent).toContain('Create /daily/notes/2026-07-10')

    const button = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((item) => item.textContent?.includes("Today's note"))
    expect(button).not.toBeNull()
    await new DOMWrapper(button!).trigger('click')
    await settle()

    expect(router.currentRoute.value.name).toBe('new')
    expect(router.currentRoute.value.query).toMatchObject({
      path: 'daily/notes/2026-07-10',
      template: 'builtin:journal',
      title: 'Daily note 2026-07-10',
    })
  })
})
