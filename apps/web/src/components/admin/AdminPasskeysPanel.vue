<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { Api, type PasskeyView } from '@/lib/api'

const passkeys = ref<PasskeyView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    passkeys.value = await Api.passkeys()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function registerPasskey(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const name = prompt('Passkey name', 'This device')?.trim() || undefined
    const options = await Api.passkeyRegistrationOptions()
    const response = await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON })
    passkeys.value = [...passkeys.value, await Api.passkeyVerifyRegistration(response, name)]
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function deletePasskey(passkey: PasskeyView): Promise<void> {
  if (!confirm(`Delete passkey "${passkey.name}"?`)) return
  busy.value = true
  error.value = null
  try {
    await Api.passkeyDelete(passkey.id)
    passkeys.value = passkeys.value.filter((item) => item.id !== passkey.id)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-3">
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="font-medium">Passkeys</div>
        <div class="text-sm text-gray-500">{{ loading ? 'Loading...' : `${passkeys.length} registered` }}</div>
      </div>
      <button class="btn-ghost" type="button" :disabled="busy" @click="registerPasskey">Add passkey</button>
    </div>
    <div v-for="passkey in passkeys" :key="passkey.id" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-800 p-3">
      <div>
        <div class="font-medium">{{ passkey.name }}</div>
        <div class="text-xs text-gray-500">{{ passkey.deviceType }} · {{ passkey.backedUp ? 'synced' : 'single device' }}</div>
      </div>
      <button class="btn-danger" type="button" :disabled="busy" @click="deletePasskey(passkey)">Delete</button>
    </div>
  </div>
</template>
