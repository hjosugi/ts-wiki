<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { useRoute, useRouter } from 'vue-router'
import { Api, setToken, type PublicAuthProvider } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useI18n } from '@/lib/i18n'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

type LoginMode = 'login' | 'register' | 'forgot' | 'reset' | 'mfa-setup'

const mode = ref<LoginMode>('login')
const email = ref('')
const name = ref('')
const password = ref('')
const totpCode = ref('')
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)
const providers = ref<PublicAuthProvider[]>([])
const registration = ref<'open' | 'off'>('open')
const mailConfigured = ref(false)
const resetToken = ref('')
const mfaSetupToken = ref('')
const mfaSecret = ref('')
const mfaUrl = ref('')
const mfaCode = ref('')

const heading = computed(() => {
  if (mode.value === 'register') return t('createAccount')
  if (mode.value === 'forgot') return t('forgotPassword')
  if (mode.value === 'reset') return t('resetPassword')
  if (mode.value === 'mfa-setup') return t('twoFactorSetup')
  return t('signIn')
})

const helperText = computed(() => {
  if (mode.value === 'register') return t('firstAccountAdmin')
  if (mode.value === 'forgot') return t('passwordResetPrompt')
  if (mode.value === 'reset') return t('chooseNewPassword')
  if (mode.value === 'mfa-setup') return t('twoFactorSetupRequired')
  return t('welcomeBack')
})

const submitLabel = computed(() => {
  if (busy.value) return '...'
  if (mode.value === 'register') return t('createAccount')
  if (mode.value === 'forgot') return t('sendResetLink')
  if (mode.value === 'reset') return t('resetPassword')
  if (mode.value === 'mfa-setup') return t('enableTwoFactor')
  return t('signIn')
})

const submitDisabled = computed(() => {
  if (busy.value) return true
  if (mode.value === 'forgot') return !email.value
  if (mode.value === 'reset') return !resetToken.value || !password.value
  if (mode.value === 'mfa-setup') return !mfaSetupToken.value || !mfaSecret.value || !mfaCode.value
  return !email.value || !password.value
})

function switchMode(next: LoginMode): void {
  mode.value = next
  error.value = null
  notice.value = null
  busy.value = false
}

async function submit(): Promise<void> {
  busy.value = true
  error.value = null
  notice.value = null
  try {
    if (mode.value === 'forgot') {
      await Api.forgotPassword(email.value)
      notice.value = t('passwordResetIfExists')
      busy.value = false
      return
    }
    if (mode.value === 'reset') {
      await Api.resetPassword(resetToken.value, password.value)
      password.value = ''
      mode.value = 'login'
      notice.value = t('passwordResetComplete')
      busy.value = false
      return
    }
    if (mode.value === 'mfa-setup') {
      const result = await Api.totpEnable(mfaCode.value, mfaSetupToken.value)
      if ('token' in result) setToken(result.token)
      auth.user = result.user
      router.push('/')
      return
    }
    if (mode.value === 'login') {
      const result = await auth.login(email.value, password.value, totpCode.value || undefined)
      if (typeof result === 'object' && result.status === 'two-factor-setup-required') {
        mfaSetupToken.value = result.setupToken
        const setup = await Api.totpSetup(result.setupToken)
        mfaSecret.value = setup.secret
        mfaUrl.value = setup.otpauthUrl
        mode.value = 'mfa-setup'
        password.value = ''
        busy.value = false
        return
      }
    } else {
      const result = await auth.register(email.value, name.value, password.value)
      if (result === 'verification-required') {
        mode.value = 'login'
        password.value = ''
        notice.value = t('verificationEmailSent')
        busy.value = false
        return
      }
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
  const settings = await Api.publicSettings().catch(() => null)
  registration.value = settings?.registration ?? 'open'
  mailConfigured.value = settings?.mailConfigured ?? false
  if (registration.value === 'off' && mode.value === 'register') mode.value = 'login'
}

function startProvider(provider: PublicAuthProvider): void {
  window.location.href = provider.loginUrl
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
  if (route.name === 'reset-password') {
    resetToken.value = String(route.query.token ?? '')
    mode.value = 'reset'
    return
  }
  if (route.name === 'verify-email') {
    const verifyToken = String(route.query.token ?? '')
    if (!verifyToken) {
      error.value = t('emailVerificationFailed')
      return
    }
    busy.value = true
    try {
      await Api.verifyEmail(verifyToken)
      notice.value = t('emailVerified')
      mode.value = 'login'
    } catch (e) {
      error.value = (e as Error).message || t('emailVerificationFailed')
    } finally {
      busy.value = false
    }
  }
})
</script>

<template>
  <div class="max-w-sm mx-auto card p-6 mt-8">
    <h1 class="text-xl font-bold mb-1">{{ heading }}</h1>
    <p class="text-sm text-gray-400 mb-5">
      {{ helperText }}
    </p>

    <form class="space-y-3" @submit.prevent="submit">
      <input v-if="mode !== 'reset' && mode !== 'mfa-setup'" v-model="email" class="input" :placeholder="t('email')" autocomplete="username" />
      <input v-if="mode === 'register'" v-model="name" class="input" :placeholder="t('displayName')" />
      <input
        v-if="mode !== 'forgot' && mode !== 'mfa-setup'"
        v-model="password"
        type="password"
        class="input"
        :placeholder="mode === 'reset' ? t('newPassword') : t('password')"
        :autocomplete="mode === 'reset' || mode === 'register' ? 'new-password' : 'current-password'"
      />
      <input
        v-if="mode === 'login'"
        v-model="totpCode"
        class="input"
        inputmode="numeric"
        :placeholder="t('twoFactorCodeIfEnabled')"
        autocomplete="one-time-code"
      />
      <div v-if="mode === 'mfa-setup'" class="space-y-2">
        <input class="input font-mono text-sm" :value="mfaSecret" readonly />
        <input class="input font-mono text-xs" :value="mfaUrl" readonly />
        <input v-model="mfaCode" class="input" inputmode="numeric" :placeholder="t('twoFactorCodeIfEnabled')" autocomplete="one-time-code" />
      </div>
      <p v-if="notice" class="text-sm text-emerald-600 dark:text-emerald-400">{{ notice }}</p>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button class="btn-primary w-full justify-center" :disabled="submitDisabled">
        {{ submitLabel }}
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
      v-if="mode === 'login' && mailConfigured"
      class="text-sm link-quiet mt-4 block"
      type="button"
      @click="switchMode('forgot')"
    >
      {{ t('forgotPassword') }}
    </button>

    <button
      v-if="mode !== 'forgot' && mode !== 'reset' && mode !== 'mfa-setup' && (registration === 'open' || mode === 'register')"
      class="text-sm link-quiet mt-4"
      type="button"
      @click="switchMode(mode === 'login' ? 'register' : 'login')"
    >
      {{ mode === 'login' ? t('needAccount') : t('haveAccount') }}
    </button>

    <button
      v-if="mode === 'forgot' || mode === 'reset'"
      class="text-sm link-quiet mt-4"
      type="button"
      @click="switchMode('login')"
    >
      {{ t('haveAccount') }}
    </button>

    <p v-if="mode !== 'reset'" class="text-xs text-gray-400 mt-6">
      {{ t('seededAdmin') }} <code class="font-mono">admin@example.com</code>; password comes from
      <code class="font-mono">db:seed</code>.
    </p>
  </div>
</template>
