import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Page, PublicUser } from '@/lib/api'
import { ApiClientError } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import PageEdit from './PageEdit.vue'

const api = vi.hoisted(() => ({
  listPages: vi.fn(),
  publicSettings: vi.fn(),
  preferences: vi.fn(),
  updatePreferences: vi.fn(),
  templates: vi.fn(),
  getPage: vi.fn(),
  assetUsage: vi.fn(),
  backlinks: vi.fn(),
  updatePage: vi.fn(),
  movePage: vi.fn(),
  createPage: vi.fn(),
  deletePage: vi.fn(),
  archivePage: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, Api: { ...actual.Api, ...api } }
})

vi.mock('@/composables/usePresence', () => ({
  usePresence: () => ({ viewers: [] }),
}))

vi.mock('@/composables/useDialogs', () => ({
  useDialogs: () => ({
    confirm: ({ message }: { message: string }) => Promise.resolve(window.confirm(message)),
    prompt: ({ message, defaultValue }: { message: string; defaultValue?: string }) =>
      Promise.resolve(window.prompt(message, defaultValue)),
  }),
}))

vi.mock('@/composables/useMarkdownFeatures', async () => {
  const { ref } = await import('vue')
  return {
    useMarkdownFeatures: () => ({
      markdownFeatures: ref({}),
      markdownRenderer: ref({ renderMarkdown: (content: string) => ({ html: content }) }),
    }),
  }
})

vi.mock('@/lib/markdownEnhance', () => ({
  vMarkdownEnhance: {},
}))

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  const AsyncStub = actual.defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<textarea aria-label="Editor content" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  })
  return {
    ...actual,
    defineAsyncComponent: () => AsyncStub,
  }
})

const user = (): PublicUser => ({
  id: 'editor-1',
  email: 'editor@example.com',
  name: 'Editor',
  role: 'editor',
  totpEnabled: false,
  profileBio: '',
  profileCoverUrl: '',
  profileLinks: [],
  profileFavoritePages: [],
})

const page = (patch: Partial<Page> = {}): Page => ({
  id: 'p1',
  path: 'docs/source',
  title: 'Source',
  description: '',
  icon: '',
  coverUrl: '',
  coverPosition: 'center',
  content: '# Source\n',
  renderedHtml: '<h1>Source</h1>',
  toc: [],
  contentType: 'markdown',
  lifecycle: 'active',
  status: 'draft',
  labels: [],
  ownerId: null,
  authorId: 'editor-1',
  reviewAt: null,
  publishAt: null,
  navOrder: null,
  pinned: false,
  spaceKey: 'main',
  locale: 'und',
  createdAt: 1,
  updatedAt: 10,
  ...patch,
})

const settle = async (): Promise<void> => {
  await flushPromises()
  await Promise.resolve()
}

async function mountEdit(path = '/_edit/docs/source'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/_new', name: 'new', component: PageEdit },
      { path: '/_edit/:path(.*)*', name: 'edit', component: PageEdit },
      { path: '/:path(.*)*', name: 'page', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuth(pinia).user = user()
  const wrapper = mount(PageEdit, {
    attachTo: document.body,
    global: { plugins: [pinia, router] },
  })
  await settle()
  return { wrapper, router }
}

function saveButton(wrapper: VueWrapper) {
  const button = wrapper.findAll('button').find((item) => item.text() === 'Save')
  expect(button).toBeTruthy()
  return button!
}

function pathInput(wrapper: VueWrapper) {
  const input = wrapper.findAll('input').find((item) => (item.element as HTMLInputElement).value === 'docs/source')
  expect(input).toBeTruthy()
  return input!
}

describe('PageEdit', () => {
  const wrappers: VueWrapper[] = []

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    for (const mock of Object.values(api)) mock.mockReset()
    api.listPages.mockResolvedValue([page()])
    api.publicSettings.mockResolvedValue({ defaultLocale: 'und', defaultEditorMode: 'markdown' })
    api.preferences.mockResolvedValue({ 'editor:mode': 'markdown' })
    api.updatePreferences.mockResolvedValue({})
    api.templates.mockResolvedValue([])
    api.getPage.mockResolvedValue(page())
    api.assetUsage.mockResolvedValue([])
    api.backlinks.mockResolvedValue([])
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
  })

  test('saves edits with the expected revision timestamp and navigates to the page', async () => {
    api.updatePage.mockImplementation(async (_path: string, body: Partial<Page>) => page({
      title: body.title ?? 'Source',
      content: body.content ?? '# Source\n',
      updatedAt: 20,
    }))
    const mounted = await mountEdit()
    wrappers.push(mounted.wrapper)

    await mounted.wrapper.find('input[aria-label="Page title"]').setValue('Updated source')
    await saveButton(mounted.wrapper).trigger('click')
    await settle()

    expect(api.updatePage).toHaveBeenCalledWith('docs/source', expect.objectContaining({
      title: 'Updated source',
      expectedUpdatedAt: 10,
    }))
    expect(mounted.router.currentRoute.value.path).toBe('/docs/source')
  })

  test('keeps a conflict draft, loads the latest page, and restores the draft on request', async () => {
    api.getPage
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page({ title: 'Latest source', content: '# Latest\n', updatedAt: 11 }))
    api.updatePage.mockRejectedValue(new ApiClientError(
      'This changed before your save finished.',
      'conflict',
      409,
      'Page changed since you opened it',
    ))
    const mounted = await mountEdit()
    wrappers.push(mounted.wrapper)

    await mounted.wrapper.find('input[aria-label="Page title"]').setValue('Draft source')
    await saveButton(mounted.wrapper).trigger('click')
    await settle()

    expect(mounted.wrapper.text()).toContain('Unsaved draft kept')
    expect((mounted.wrapper.find('input[aria-label="Page title"]').element as HTMLInputElement).value).toBe('Latest source')

    const restore = mounted.wrapper.findAll('button').find((item) => item.text() === 'Restore my draft')
    expect(restore).toBeTruthy()
    await restore!.trigger('click')
    expect((mounted.wrapper.find('input[aria-label="Page title"]').element as HTMLInputElement).value).toBe('Draft source')
  })

  test('asks before moving a page with inbound links and cancels without saving', async () => {
    api.backlinks.mockResolvedValue([{ path: 'docs/other', title: 'Other', label: 'Other', kind: 'wikilink' }])
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const mounted = await mountEdit()
    wrappers.push(mounted.wrapper)

    await pathInput(mounted.wrapper).setValue('docs/moved')
    await saveButton(mounted.wrapper).trigger('click')
    await settle()

    expect(confirm).toHaveBeenCalledWith('1 inbound link points to /docs/source. Move anyway?')
    expect(api.updatePage).not.toHaveBeenCalled()
    expect((pathInput(mounted.wrapper).element as HTMLInputElement).value).toBe('docs/source')
  })

  test('prevents accidental tab close when the page has unsaved changes', async () => {
    const mounted = await mountEdit()
    wrappers.push(mounted.wrapper)

    await mounted.wrapper.find('input[aria-label="Page title"]').setValue('Dirty source')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})
