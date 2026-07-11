import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultPublicSettings } from '@kawaii-wiki/core'
import AppHeader from './AppHeader.vue'

const api = vi.hoisted(() => ({
  publicSettings: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, Api: { ...actual.Api, publicSettings: api.publicSettings } }
})

const mountHeader = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/_login', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(AppHeader, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  return wrapper
}

describe('AppHeader', () => {
  beforeEach(() => {
    api.publicSettings.mockReset()
    api.publicSettings.mockResolvedValue(defaultPublicSettings())
  })

  test('exposes mobile navigation and search command triggers', async () => {
    const mobileNav = vi.fn()
    const commandPalette = vi.fn()
    window.addEventListener('open-mobile-navigation', mobileNav)
    window.addEventListener('open-command-palette', commandPalette)
    try {
      const wrapper = await mountHeader()

      await wrapper.find('button[aria-label="Open navigation"]').trigger('click')
      await wrapper.find('button[aria-label="Search pages and commands"]').trigger('click')

      expect(wrapper.find('input[aria-label="Search..."]').exists()).toBe(true)
      expect(mobileNav).toHaveBeenCalledTimes(1)
      expect(commandPalette).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('open-mobile-navigation', mobileNav)
      window.removeEventListener('open-command-palette', commandPalette)
    }
  })

  test('uses the branded sparkle mark when no custom logo is configured', async () => {
    const wrapper = await mountHeader()

    expect(wrapper.find('.brand-mark').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('▲')
  })
})
