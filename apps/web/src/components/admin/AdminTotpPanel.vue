<script setup lang="ts">
import { ref } from 'vue'
import { Api } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useI18n } from '@/lib/i18n'

const auth = useAuth()
const { t } = useI18n()
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const secret = ref('')
const url = ref('')
const code = ref('')
const recoveryCodes = ref<string[]>([])
const busy = ref(false)

async function setupTotp(): Promise<void> {
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const setup = await Api.totpSetup()
    secret.value = setup.secret
    url.value = setup.otpauthUrl
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function enableTotp(): Promise<void> {
  if (!code.value) return
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const result = await Api.totpEnable(code.value)
    auth.user = result.user
    recoveryCodes.value = result.recoveryCodes
    notice.value = t('recoveryCodesGenerated')
    code.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function regenerateRecoveryCodes(): Promise<void> {
  if (!code.value) return
  busy.value = true
  error.value = null
  notice.value = null
  try {
    recoveryCodes.value = await Api.totpRecoveryCodes(code.value)
    notice.value = t('recoveryCodesGenerated')
    code.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function copyRecoveryCodes(): Promise<void> {
  if (!recoveryCodes.value.length) return
  await navigator.clipboard?.writeText(recoveryCodes.value.join('\n'))
  notice.value = t('copied')
}

async function disableTotp(): Promise<void> {
  busy.value = true
  error.value = null
  notice.value = null
  try {
    auth.user = await Api.totpDisable(code.value || undefined)
    secret.value = ''
    url.value = ''
    code.value = ''
    recoveryCodes.value = []
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-600 dark:text-emerald-400">{{ notice }}</p>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="font-medium">Two-factor authentication</div>
        <div class="text-sm text-gray-500">{{ auth.user?.totpEnabled ? 'Enabled' : 'Disabled' }}</div>
      </div>
      <button v-if="!auth.user?.totpEnabled" class="btn-ghost" type="button" :disabled="busy" @click="setupTotp">Set up</button>
    </div>
    <div v-if="secret" class="space-y-2">
      <input class="input font-mono text-sm" :value="secret" aria-label="Two-factor secret" readonly />
      <input class="input font-mono text-xs" :value="url" aria-label="Two-factor setup URL" readonly />
    </div>
    <div v-if="recoveryCodes.length" class="rounded-md border border-[var(--c-border)] bg-[var(--c-surface-muted)] p-3">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="font-medium">{{ t('backupCodes') }}</div>
        <button class="btn-ghost py-1 text-xs" type="button" @click="copyRecoveryCodes">{{ t('copyBackupCodes') }}</button>
      </div>
      <p class="mb-2 text-xs text-[var(--c-text-muted)]">{{ t('saveRecoveryCodes') }}</p>
      <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <code v-for="recoveryCode in recoveryCodes" :key="recoveryCode" class="rounded bg-[var(--c-surface)] px-2 py-1 font-mono text-sm">
          {{ recoveryCode }}
        </code>
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      <input v-model="code" class="input max-w-40" inputmode="numeric" placeholder="2FA code" aria-label="2FA code" autocomplete="one-time-code" />
      <button v-if="!auth.user?.totpEnabled" class="btn-primary" type="button" :disabled="busy || !secret || !code" @click="enableTotp">Enable</button>
      <button v-else class="btn-ghost" type="button" :disabled="busy || !code" @click="regenerateRecoveryCodes">{{ t('regenerateBackupCodes') }}</button>
      <button v-if="auth.user?.totpEnabled" class="btn-danger" type="button" :disabled="busy || !code" @click="disableTotp">Disable</button>
    </div>
  </div>
</template>
