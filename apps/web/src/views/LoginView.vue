<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { useRouter } from 'vue-router'
import { Api, setToken, type PublicAuthProvider } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useI18n } from '@/lib/i18n'

const auth = useAuth()
const router = useRouter()
const { t } = useI18n()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const name = ref('')
const password = ref('')
const totpCode = ref('')
const error = ref<string | null>(null)
const busy = ref(false)
const providers = ref<PublicAuthProvider[]>([])
const registration = ref<'open' | 'off'>('open')

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

async function loadPublicSettings(): Promise<void> {
  registration.value = await Api.publicSettings().then((settings) => settings.registration).catch(() => 'open')
  if (registration.value === 'off' && mode.value === 'register') mode.value = 'login'
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
  await Promise.all([loadProviders(), loadPublicSettings()])
})
</script>

<template>
  <div class="max-w-sm mx-auto card p-6 mt-8">
    <h1 class="text-xl font-bold mb-1">{{ mode === 'login' ? t('signIn') : t('createAccount') }}</h1>
    <p class="text-sm text-gray-400 mb-5">
      {{ mode === 'login' ? t('welcomeBack') : t('firstAccountAdmin') }}
    </p>

    <form class="space-y-3" @submit.prevent="submit">
      <input v-model="email" class="input" :placeholder="t('email')" autocomplete="username" />
      <input v-if="mode === 'register'" v-model="name" class="input" :placeholder="t('displayName')" />
      <input
        v-model="password"
        type="password"
        class="input"
        :placeholder="t('password')"
        autocomplete="current-password"
      />
      <input
        v-if="mode === 'login'"
        v-model="totpCode"
        class="input"
        inputmode="numeric"
        :placeholder="t('twoFactorCodeIfEnabled')"
        autocomplete="one-time-code"
      />
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button class="btn-primary w-full justify-center" :disabled="busy || !email || !password">
        {{ busy ? '...' : mode === 'login' ? t('signIn') : t('createAccount') }}
      </button>
    </form>

    <div v-if="mode === 'login'" class="mt-4 space-y-2">
      <button class="btn-ghost w-full justify-center" type="button" :disabled="busy" @click="signInWithPasskey">
        {{ t('signInWithPasskey') }}
      </button>
      <button
        v-for="provider in providers"
        :key="provider.id"
        class="btn-ghost w-full justify-center"
        type="button"
        @click="startProvider(provider)"
      >
        {{ t('signInWith', { provider: provider.label }) }}
      </button>
    </div>

    <button
      v-if="registration === 'open' || mode === 'register'"
      class="text-sm link-quiet mt-4"
      @click="mode = mode === 'login' ? 'register' : 'login'"
    >
      {{ mode === 'login' ? t('needAccount') : t('haveAccount') }}
    </button>

    <p class="text-xs text-gray-400 mt-6">
      {{ t('seededAdmin') }} <code class="font-mono">admin@example.com</code>; password comes from
      <code class="font-mono">db:seed</code>.
    </p>
  </div>
</template>
