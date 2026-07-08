import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from './App.vue'

const api = vi.hoisted(() => ({
  listPages: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, Api: { ...actual.Api, listPages: api.listPages } }
})

const makeRouter = async (): Promise<Router> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
      { path: '/docs/next', name: 'next', component: { template: '<div>Next</div>' } },
      { path: '/_login', name: 'login', component: { template: '<div>Login</div>' } },
      { path: '/_share/:token', name: 'shared', component: { template: '<div>Shared</div>' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return router
}

describe('App', () => {
  beforeEach(() => {
    api.listPages.mockResolvedValue([])
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('exposes a skip link and moves focus to the main landmark after navigation', async () => {
    const router = await makeRouter()
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [createPinia(), router],
        stubs: {
          AppHeader: { template: '<header />' },
          AppFooter: { template: '<footer />' },
          CommandPalette: { template: '<div />' },
          ShortcutsHelp: { template: '<div />' },
          DrawerSheet: { template: '<div><slot /></div>' },
          PageTree: { template: '<nav />' },
          EmptyState: { template: '<div><slot name="actions" /></div>' },
        },
      },
    })
    await flushPromises()

    const skip = wrapper.find('a[href="#main"]')
    const main = wrapper.find('main#main')
    expect(skip.text()).toBe('Skip to content')
    expect(main.attributes('tabindex')).toBe('-1')

    await router.push('/docs/next')
    await router.isReady()
    await nextTick()
    await flushPromises()

    expect(document.activeElement).toBe(main.element)
  })
})
