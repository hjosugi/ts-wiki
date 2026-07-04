import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuth } from '@/stores/auth'
import { setToken } from '@/lib/api'

const mocks = vi.hoisted(() => ({
  providers: [] as Array<{ url: string; room: string; options: { params?: Record<string, string> } }>,
}))

vi.mock('codemirror', () => ({
  basicSetup: [],
}))

vi.mock('@codemirror/view', () => ({
  EditorView: class {
    static lineWrapping = []
    static domEventHandlers = vi.fn(() => [])
    constructor() {}
    destroy() {}
    focus() {}
  },
}))

vi.mock('@codemirror/state', () => ({
  EditorState: { create: vi.fn(() => ({})) },
}))

vi.mock('@codemirror/lang-markdown', () => ({ markdown: vi.fn(() => []) }))
vi.mock('@codemirror/theme-one-dark', () => ({ oneDark: [] }))
vi.mock('y-codemirror.next', () => ({ yCollab: vi.fn(() => []) }))
vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    awareness = { setLocalStateField: vi.fn() }
    constructor(url: string, room: string, _doc: unknown, options: { params?: Record<string, string> }) {
      mocks.providers.push({ url, room, options })
    }
    on(_event: string, _callback: unknown) {}
    destroy() {}
  },
}))

describe('CollabEditor', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    mocks.providers.splice(0)
    setToken('token-123')
    pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuth()
    auth.user = { id: 'u1', email: 'ada@example.com', name: 'Ada', role: 'editor', totpEnabled: false }
  })

  test('connects to the encoded room with the current auth token', async () => {
    const CollabEditor = (await import('./CollabEditor.vue')).default
    mount(CollabEditor, {
      props: { room: 'docs/a page' },
      global: { plugins: [pinia] },
      attachTo: document.body,
    })

    expect(mocks.providers[0]).toMatchObject({
      url: 'ws://localhost:3000/api/collab',
      room: 'docs%2Fa%20page',
      options: { params: { token: 'token-123' } },
    })
  })
})
