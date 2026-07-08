<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api, setToken, type FtsTokenizer, type SetupInput } from '@/lib/api'
import { applyBranding } from '@/lib/branding'
import { applySiteDefault, type ThemeMode } from '@/composables/useTheme'
import { useAuth } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuth()

const siteTitle = ref('ts-wiki')
const theme = ref<ThemeMode>('system')
const tokenizer = ref<FtsTokenizer>('unicode61')
const sampleContent = ref(true)
const name = ref('')
const email = ref('')
const password = ref('')
const busy = ref(false)
const checking = ref(true)
const error = ref<string | null>(null)

const canSubmit = computed(() =>
  !busy.value
  && siteTitle.value.trim().length > 0
  && name.value.trim().length > 0
  && email.value.trim().length >= 3
  && password.value.length >= 6,
)

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const tokenizerOptions: Array<{ value: FtsTokenizer; label: string; description: string }> = [
  {
    value: 'unicode61',
    label: 'Standard',
    description: 'Best for English and whitespace-separated languages.',
  },
  {
    value: 'trigram',
    label: 'CJK-ready',
    description: 'Better for Japanese, Chinese, and Korean search because words are not always separated by spaces.',
  },
]

const redirectTarget = (homePath: string): string => {
  const redirect = String(route.query.redirect ?? '')
  if (redirect.startsWith('/') && !redirect.startsWith('//')) return redirect
  return `/${homePath || 'home'}`
}

async function completeSetup(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  error.value = null
  try {
    const input: SetupInput = {
      email: email.value.trim(),
      name: name.value.trim(),
      password: password.value,
      siteTitle: siteTitle.value.trim(),
      theme: theme.value,
      tokenizer: tokenizer.value,
      sampleContent: sampleContent.value,
    }
    const result = await Api.completeSetup(input)
    setToken(result.token)
    auth.user = result.user
    applyBranding({
      ...result.settings,
      privateWiki: false,
      registration: 'open',
      mailConfigured: false,
      requireEmailVerification: false,
      requireTwoFactor: false,
    })
    applySiteDefault(result.settings.theme)
    await router.push(redirectTarget(result.settings.homePath))
  } catch (e) {
    error.value = (e as Error).message
    busy.value = false
  }
}

onMounted(async () => {
  try {
    const status = await Api.setupStatus()
    if (!status.needsSetup) {
      await router.replace('/')
      return
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    checking.value = false
  }
})
</script>

<template>
  <div class="min-h-screen w-full bg-[var(--c-bg)] px-4 py-6 sm:py-10">
    <div class="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <section class="flex flex-col justify-center">
        <p class="text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">First-run setup</p>
        <h1 class="mt-2 text-3xl font-bold sm:text-4xl">Create your wiki</h1>
        <p class="mt-4 max-w-prose text-sm leading-6 text-[var(--c-text-muted)]">
          Choose the site defaults and create the owner account. This setup screen locks as soon as an admin exists.
        </p>
        <dl class="mt-8 grid gap-3 text-sm">
          <div class="border-l-2 border-[var(--c-accent)] pl-3">
            <dt class="font-semibold">No seed command</dt>
            <dd class="text-[var(--c-text-muted)]">The owner account and first page are created here.</dd>
          </div>
          <div class="border-l-2 border-[var(--c-border)] pl-3">
            <dt class="font-semibold">Search-ready</dt>
            <dd class="text-[var(--c-text-muted)]">Pick the tokenizer before content is indexed.</dd>
          </div>
        </dl>
      </section>

      <form class="card p-4 sm:p-6" @submit.prevent="completeSetup">
        <div v-if="checking" class="text-sm text-[var(--c-text-muted)]">Checking setup status...</div>
        <div v-else class="space-y-6">
          <section class="space-y-3">
            <h2 class="text-base font-semibold">Site</h2>
            <label class="block space-y-1">
              <span class="text-sm font-medium">Site title</span>
              <input v-model="siteTitle" class="input" autocomplete="organization" required />
            </label>

            <fieldset class="space-y-2">
              <legend class="text-sm font-medium">Theme</legend>
              <div class="grid grid-cols-3 gap-2">
                <button
                  v-for="option in themeOptions"
                  :key="option.value"
                  type="button"
                  class="rounded-[var(--radius)] border px-3 py-2 text-sm font-medium transition-colors"
                  :class="theme === option.value ? 'border-[var(--c-accent)] bg-[var(--c-surface-muted)] text-[var(--c-text)]' : 'border-[var(--c-border)] text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)]'"
                  :aria-pressed="theme === option.value"
                  @click="theme = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </fieldset>

            <fieldset class="space-y-2">
              <legend class="text-sm font-medium">Search tokenizer</legend>
              <div class="grid gap-2">
                <label
                  v-for="option in tokenizerOptions"
                  :key="option.value"
                  class="block cursor-pointer rounded-[var(--radius)] border p-3 transition-colors"
                  :class="tokenizer === option.value ? 'border-[var(--c-accent)] bg-[var(--c-surface-muted)]' : 'border-[var(--c-border)] hover:bg-[var(--c-surface-muted)]'"
                >
                  <span class="flex items-start gap-3">
                    <input v-model="tokenizer" class="mt-1" type="radio" name="tokenizer" :value="option.value" />
                    <span>
                      <span class="block text-sm font-semibold">{{ option.label }}</span>
                      <span class="block text-sm text-[var(--c-text-muted)]">{{ option.description }}</span>
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <label class="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3">
              <input v-model="sampleContent" class="mt-1" type="checkbox" />
              <span>
                <span class="block text-sm font-semibold">Add sample help pages</span>
                <span class="block text-sm text-[var(--c-text-muted)]">Creates two starter pages under <code class="font-mono">help/</code>.</span>
              </span>
            </label>
          </section>

          <section class="space-y-3">
            <h2 class="text-base font-semibold">Owner account</h2>
            <label class="block space-y-1">
              <span class="text-sm font-medium">Display name</span>
              <input v-model="name" class="input" autocomplete="name" required />
            </label>
            <label class="block space-y-1">
              <span class="text-sm font-medium">Email</span>
              <input v-model="email" class="input" type="email" autocomplete="username" required />
            </label>
            <label class="block space-y-1">
              <span class="text-sm font-medium">Password</span>
              <input v-model="password" class="input" type="password" autocomplete="new-password" minlength="6" required />
            </label>
          </section>

          <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
          <button class="btn-primary w-full justify-center" type="submit" :disabled="!canSubmit">
            {{ busy ? 'Creating...' : 'Create wiki' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
