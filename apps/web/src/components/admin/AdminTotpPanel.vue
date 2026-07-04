<script setup lang="ts">
import { ref } from 'vue'
import { Api } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const error = ref<string | null>(null)
const secret = ref('')
const url = ref('')
const code = ref('')
const busy = ref(false)

async function setupTotp(): Promise<void> {
  busy.value = true
  error.value = null
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
  try {
    auth.user = await Api.totpEnable(code.value)
    code.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function disableTotp(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    auth.user = await Api.totpDisable(code.value || undefined)
    secret.value = ''
    url.value = ''
    code.value = ''
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
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="font-medium">Two-factor authentication</div>
        <div class="text-sm text-gray-500">{{ auth.user?.totpEnabled ? 'Enabled' : 'Disabled' }}</div>
      </div>
      <button v-if="!auth.user?.totpEnabled" class="btn-ghost" type="button" :disabled="busy" @click="setupTotp">Set up</button>
    </div>
    <div v-if="secret" class="space-y-2">
      <input class="input font-mono text-sm" :value="secret" readonly />
      <input class="input font-mono text-xs" :value="url" readonly />
    </div>
    <div class="flex flex-wrap gap-2">
      <input v-model="code" class="input max-w-40" inputmode="numeric" placeholder="2FA code" autocomplete="one-time-code" />
      <button v-if="!auth.user?.totpEnabled" class="btn-primary" type="button" :disabled="busy || !secret || !code" @click="enableTotp">Enable</button>
      <button v-else class="btn-danger" type="button" :disabled="busy || !code" @click="disableTotp">Disable</button>
    </div>
  </div>
</template>
