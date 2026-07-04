<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { useRouter } from 'vue-router'
import { Api, setToken, type PublicAuthProvider } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const name = ref('')
const password = ref('')
const totpCode = ref('')
const error = ref<string | null>(null)
const busy = ref(false)
const providers = ref<PublicAuthProvider[]>([])

async function submit(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    if (mode.value === 'login') {
      await auth.login(email.value, password.value, totpCode.value || undefined)
    } else {
      await auth.register(email.value, name.value, password.value)
    }
    router.push('/')
  } catch (e) {
    error.value = (e as Error).message
    busy.value = false
  }
}

async function signInWithPasskey(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const options = await Api.passkeyLoginOptions(email.value || undefined)
    const response = await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON })
    const result = await Api.passkeyLoginVerify(response)
    setToken(result.token)
    auth.user = result.user
    router.push('/')
  } catch (e) {
    error.value = (e as Error).message
    busy.value = false
  }
}

async function loadProviders(): Promise<void> {
  providers.value = await Api.authProviders().catch(() => [])
}

function startProvider(provider: PublicAuthProvider): void {
  window.location.href = `/api/auth/oidc/${encodeURIComponent(provider.id)}/start`
}

onMounted(async () => {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = hash.get('token')
  if (token) {
    setToken(token)
    window.history.replaceState(null, '', '/')
    await auth.fetchMe()
    router.push('/')
    return
  }
  await loadProviders()
})
</script>

<template>
  <div class="max-w-sm mx-auto card p-6 mt-8">
    <h1 class="text-xl font-bold mb-1">{{ mode === 'login' ? 'Sign in' : 'Create account' }}</h1>
    <p class="text-sm text-gray-400 mb-5">
      {{ mode === 'login' ? 'Welcome back.' : 'The first account to register becomes the admin.' }}
    </p>

    <form class="space-y-3" @submit.prevent="submit">
      <input v-model="email" class="input" placeholder="Email" autocomplete="username" />
      <input v-if="mode === 'register'" v-model="name" class="input" placeholder="Display name" />
      <input
        v-model="password"
        type="password"
        class="input"
        placeholder="Password"
        autocomplete="current-password"
      />
      <input
        v-if="mode === 'login'"
        v-model="totpCode"
        class="input"
        inputmode="numeric"
        placeholder="2FA code if enabled"
        autocomplete="one-time-code"
      />
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button class="btn-primary w-full justify-center" :disabled="busy || !email || !password">
        {{ busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account' }}
      </button>
    </form>

    <div v-if="mode === 'login'" class="mt-4 space-y-2">
      <button class="btn-ghost w-full justify-center" type="button" :disabled="busy" @click="signInWithPasskey">
        Sign in with passkey
      </button>
      <button
        v-for="provider in providers"
        :key="provider.id"
        class="btn-ghost w-full justify-center"
        type="button"
        @click="startProvider(provider)"
      >
        Sign in with {{ provider.label }}
      </button>
    </div>

    <button
      class="text-sm link-quiet mt-4"
      @click="mode = mode === 'login' ? 'register' : 'login'"
    >
      {{ mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in' }}
    </button>

    <p class="text-xs text-gray-400 mt-6">
      Seeded admin: <code class="font-mono">admin@example.com</code>; password comes from
      <code class="font-mono">db:seed</code>.
    </p>
  </div>
</template>
