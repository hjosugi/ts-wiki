<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { computed, ref } from 'vue'
import { Api, type PublicSettings } from '@/lib/api'
import Skeleton from '@/components/Skeleton.vue'
import { useAsyncData } from '@/composables/useAsyncData'

type PolicySettings = Pick<
  PublicSettings,
  | 'registration'
  | 'privateWiki'
  | 'requireEmailVerification'
  | 'requireTwoFactor'
  | 'tokenTtlSeconds'
  | 'assetMaxBytes'
  | 'defaultEditorMode'
  | 'mailConfigured'
>

const settings = ref<PolicySettings | null>(null)
const sessionHours = ref(24 * 30)
const uploadMegabytes = ref(25)
const saving = ref(false)
const notice = ref<string | null>(null)

const canSave = computed(() =>
  Boolean(settings.value)
  && Number.isFinite(sessionHours.value)
  && sessionHours.value >= 1
  && sessionHours.value <= 8760
  && Number.isFinite(uploadMegabytes.value)
  && uploadMegabytes.value >= 1
  && uploadMegabytes.value <= 100,
)

const syncInputs = (next: PolicySettings): void => {
  settings.value = next
  sessionHours.value = Math.max(1, Math.round(next.tokenTtlSeconds / 3600))
  uploadMegabytes.value = Math.max(1, Math.round(next.assetMaxBytes / (1024 * 1024)))
}

const { loading, error, reload: load } = useAsyncData(async () => {
    const next = await Api.publicSettings()
    syncInputs({
      registration: next.registration,
      privateWiki: next.privateWiki,
      requireEmailVerification: next.requireEmailVerification,
      requireTwoFactor: next.requireTwoFactor,
      tokenTtlSeconds: next.tokenTtlSeconds,
      assetMaxBytes: next.assetMaxBytes,
      defaultEditorMode: next.defaultEditorMode,
      mailConfigured: next.mailConfigured,
    })
    return next
})

async function save(): Promise<void> {
  if (!settings.value || !canSave.value) return
  saving.value = true
  error.value = null
  notice.value = null
  try {
    const saved = await Api.adminUpdateSettings({
      registration: settings.value.registration,
      privateWiki: settings.value.privateWiki,
      requireEmailVerification: settings.value.requireEmailVerification,
      requireTwoFactor: settings.value.requireTwoFactor,
      tokenTtlSeconds: Math.round(sessionHours.value * 3600),
      assetMaxBytes: Math.round(uploadMegabytes.value * 1024 * 1024),
      defaultEditorMode: settings.value.defaultEditorMode,
    })
    syncInputs({
      registration: saved.registration,
      privateWiki: saved.privateWiki,
      requireEmailVerification: saved.requireEmailVerification,
      requireTwoFactor: saved.requireTwoFactor,
      tokenTtlSeconds: saved.tokenTtlSeconds,
      assetMaxBytes: saved.assetMaxBytes,
      defaultEditorMode: saved.defaultEditorMode,
      mailConfigured: settings.value.mailConfigured,
    })
    notice.value = 'Site policy saved.'
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    saving.value = false
  }
}

</script>

<template>
  <section>
    <h2 class="mb-3 text-lg font-semibold">Site policy</h2>
    <p v-if="error" class="mb-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-if="notice" class="mb-3 text-sm text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
    <Skeleton v-if="loading" class="mb-3" label="Loading site policy" :lines="4" />

    <form v-if="settings" class="card max-w-3xl space-y-5 p-4" @submit.prevent="save">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span class="font-medium">Account registration</span>
          <select v-model="settings.registration" class="input">
            <option value="open">Open</option>
            <option value="off">Off</option>
          </select>
          <span class="block text-xs text-[var(--c-text-muted)]">First-run owner setup still works before an admin exists.</span>
        </label>

        <label class="space-y-1 text-sm">
          <span class="font-medium">Default editor</span>
          <select v-model="settings.defaultEditorMode" class="input">
            <option value="visual">Visual</option>
            <option value="markdown">Markdown</option>
          </select>
          <span class="block text-xs text-[var(--c-text-muted)]">Users can override this by switching modes while editing.</span>
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span class="font-medium">Session lifetime</span>
          <span class="flex items-center gap-2">
            <input v-model.number="sessionHours" class="input" type="number" min="1" max="8760" step="1" />
            <span class="shrink-0 text-sm text-[var(--c-text-muted)]">hours</span>
          </span>
        </label>

        <label class="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
          <input v-model="settings.privateWiki" class="mt-1" type="checkbox" />
          <span>
            <span class="block font-medium">Private wiki</span>
            <span class="block text-[var(--c-text-muted)]">Anonymous visitors must sign in before reading pages.</span>
          </span>
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
          <input v-model="settings.requireTwoFactor" class="mt-1" type="checkbox" />
          <span>
            <span class="block font-medium">Require two-factor authentication</span>
            <span class="block text-[var(--c-text-muted)]">Users without a passkey or TOTP code are guided through setup at login.</span>
          </span>
        </label>
      </div>

      <label class="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
        <input
          v-model="settings.requireEmailVerification"
          class="mt-1"
          type="checkbox"
          :disabled="!settings.mailConfigured && !settings.requireEmailVerification"
        />
        <span>
          <span class="block font-medium">Require email verification</span>
          <span class="block text-[var(--c-text-muted)]">
            {{
              settings.mailConfigured
                ? 'New local accounts must verify email before login.'
                : settings.requireEmailVerification
                  ? 'SMTP is not configured; disable this policy or configure SMTP.'
                  : 'Configure SMTP before enabling email verification.'
            }}
          </span>
        </span>
      </label>

      <label class="block space-y-1 text-sm sm:max-w-xs">
        <span class="font-medium">Upload limit</span>
        <span class="flex items-center gap-2">
          <input v-model.number="uploadMegabytes" class="input" type="number" min="1" max="100" step="1" />
          <span class="shrink-0 text-sm text-[var(--c-text-muted)]">MB</span>
        </span>
      </label>

      <p class="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-muted)] px-3 py-2 text-xs text-[var(--c-text-muted)]">
        Database, storage credentials, SMTP connection details, OIDC secrets, webhook SSRF policy, ports, CORS, and Git remotes stay in server environment settings.
      </p>

      <button class="btn-primary" type="submit" :disabled="saving || !canSave">
        {{ saving ? 'Saving...' : 'Save site policy' }}
      </button>
    </form>
  </section>
</template>
