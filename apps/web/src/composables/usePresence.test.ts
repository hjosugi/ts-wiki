import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuth } from '@/stores/auth'

const mocks = vi.hoisted(() => {
  const disconnects: Array<ReturnType<typeof vi.fn>> = []
  const connectPresence = vi.fn((_path: string, _identity: unknown, onViewers: (viewers: unknown[]) => void) => {
    const disconnect = vi.fn()
    disconnects.push(disconnect)
    onViewers([{ userId: 'u1', name: 'Ada', mode: 'editing' }])
    return disconnect
  })
  return { connectPresence, disconnects }
})

vi.mock('@/lib/presence', () => ({
  connectPresence: mocks.connectPresence,
}))

describe('usePresence', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    mocks.connectPresence.mockClear()
    mocks.disconnects.splice(0)
    pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuth()
    auth.user = { id: 'u1', email: 'ada@example.com', name: 'Ada', role: 'editor', totpEnabled: false }
  })

  test('connects with the current identity, updates viewers, and reconnects on path change', async () => {
    const path = ref('docs/a')
    const { usePresence } = await import('./usePresence')
    const Harness = defineComponent({
      setup() {
        const { viewers } = usePresence(path, 'editing')
        return { viewers }
      },
      template: '<div>{{ viewers.length }} {{ viewers[0]?.name }}</div>',
    })

    const wrapper = mount(Harness, { global: { plugins: [pinia] } })
    expect(mocks.connectPresence).toHaveBeenCalledWith(
      'docs/a',
      { name: 'Ada', userId: 'u1', mode: 'editing' },
      expect.any(Function),
    )
    expect(wrapper.text()).toContain('1 Ada')

    path.value = 'docs/b'
    await nextTick()
    expect(mocks.disconnects[0]).toHaveBeenCalled()
    expect(mocks.connectPresence).toHaveBeenLastCalledWith(
      'docs/b',
      { name: 'Ada', userId: 'u1', mode: 'editing' },
      expect.any(Function),
    )
  })
})
