import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { Api, getToken, setToken, type PublicUser } from '@/lib/api'

export const useAuth = defineStore('auth', () => {
  const user = ref<PublicUser | null>(null)
  const ready = ref(false)

  const isAuthed = computed(() => user.value !== null)
  const canEdit = computed(() => user.value?.role === 'admin' || user.value?.role === 'editor')
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function fetchMe(): Promise<void> {
    if (!getToken()) {
      ready.value = true
      return
    }
    try {
      user.value = await Api.me()
    } catch {
      setToken(null)
      user.value = null
    } finally {
      ready.value = true
    }
  }

  async function login(email: string, password: string, totpCode?: string): Promise<void> {
    const res = await Api.login({ email, password, totpCode })
    setToken(res.token)
    user.value = res.user
  }

  async function register(email: string, name: string, password: string): Promise<void> {
    const res = await Api.register({ email, name, password })
    setToken(res.token)
    user.value = res.user
  }

  function logout(): void {
    setToken(null)
    user.value = null
  }

  return { user, ready, isAuthed, canEdit, isAdmin, fetchMe, login, register, logout }
})
