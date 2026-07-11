<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { computed, ref } from 'vue'
import { Api, type PublicSettings } from '@/lib/api'
import Skeleton from '@/components/Skeleton.vue'
import { useAsyncData } from '@/composables/useAsyncData'
import { useI18n } from '@/lib/i18n'

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
const { t } = useI18n()

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
    notice.value = t('sitePolicySaved')
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    saving.value = false
  }
}

</script>

<template>
  <section>
    <h2 class="mb-3 text-lg font-semibold">{{ t('sitePolicy') }}</h2>
    <p v-if="error" class="mb-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-if="notice" class="mb-3 text-sm text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
    <Skeleton v-if="loading" class="mb-3" label="Loading site policy" :lines="4" />

    <form v-if="settings" class="card max-w-3xl space-y-5 p-4" @submit.prevent="save">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span class="font-medium">{{ t('accountRegistration') }}</span>
          <select v-model="settings.registration" class="input">
            <option value="open">{{ t('registrationOpen') }}</option>
            <option value="off">{{ t('registrationOff') }}</option>
          </select>
          <span class="block text-xs text-[var(--c-text-muted)]">{{ t('ownerSetupHint') }}</span>
        </label>

        <label class="space-y-1 text-sm">
          <span class="font-medium">{{ t('defaultEditor') }}</span>
          <select v-model="settings.defaultEditorMode" class="input">
            <option value="visual">{{ t('visual') }}</option>
            <option value="markdown">{{ t('markdown') }}</option>
          </select>
          <span class="block text-xs text-[var(--c-text-muted)]">{{ t('editorOverrideHint') }}</span>
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span class="font-medium">{{ t('sessionLifetime') }}</span>
          <span class="flex items-center gap-2">
            <input v-model.number="sessionHours" class="input" type="number" min="1" max="8760" step="1" />
            <span class="shrink-0 text-sm text-[var(--c-text-muted)]">{{ t('hours') }}</span>
          </span>
        </label>

        <label class="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
          <input v-model="settings.privateWiki" class="mt-1" type="checkbox" />
          <span>
            <span class="block font-medium">{{ t('privateWiki') }}</span>
            <span class="block text-[var(--c-text-muted)]">{{ t('privateWikiHint') }}</span>
          </span>
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
          <input v-model="settings.requireTwoFactor" class="mt-1" type="checkbox" />
          <span>
            <span class="block font-medium">{{ t('requireTwoFactor') }}</span>
            <span class="block text-[var(--c-text-muted)]">{{ t('requireTwoFactorHint') }}</span>
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
          <span class="block font-medium">{{ t('requireEmailVerification') }}</span>
          <span class="block text-[var(--c-text-muted)]">
            {{
              settings.mailConfigured
                ? t('emailVerificationReadyHint')
                : settings.requireEmailVerification
                  ? t('emailVerificationEnabledNoSmtp')
                  : t('emailVerificationNeedsSmtp')
            }}
          </span>
        </span>
      </label>

      <label class="block space-y-1 text-sm sm:max-w-xs">
        <span class="font-medium">{{ t('uploadLimit') }}</span>
        <span class="flex items-center gap-2">
          <input v-model.number="uploadMegabytes" class="input" type="number" min="1" max="100" step="1" />
          <span class="shrink-0 text-sm text-[var(--c-text-muted)]">MB</span>
        </span>
      </label>

      <p class="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-muted)] px-3 py-2 text-xs text-[var(--c-text-muted)]">
        {{ t('serverSettingsHint') }}
      </p>

      <button class="btn-primary" type="submit" :disabled="saving || !canSave">
        {{ saving ? t('saving') : t('saveSitePolicy') }}
      </button>
    </form>
  </section>
</template>
