<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref } from 'vue'
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { Api, type PasskeyView } from '@/lib/api'
import Skeleton from '@/components/Skeleton.vue'
import { useDialogs } from '@/composables/useDialogs'
import { useAsyncData } from '@/composables/useAsyncData'

const { data: passkeys, loading, error, reload: load } = useAsyncData<PasskeyView[]>(Api.passkeys, { initial: [] })
const busy = ref(false)
const dialogs = useDialogs()

async function registerPasskey(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const name = (await dialogs.prompt({ message: 'Name this passkey.', inputLabel: 'Passkey name', defaultValue: 'This device' }))?.trim() || undefined
    const options = await Api.passkeyRegistrationOptions()
    const response = await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON })
    passkeys.value = [...passkeys.value, await Api.passkeyVerifyRegistration(response, name)]
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function deletePasskey(passkey: PasskeyView): Promise<void> {
  if (!await dialogs.confirm({ message: `Delete passkey "${passkey.name}"?`, danger: true })) return
  busy.value = true
  error.value = null
  try {
    await Api.passkeyDelete(passkey.id)
    passkeys.value = passkeys.value.filter((item) => item.id !== passkey.id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

</script>

<template>
  <div class="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-3">
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="font-medium">Passkeys</div>
        <div v-if="!loading" class="text-sm text-gray-500">{{ passkeys.length }} registered</div>
      </div>
      <button class="btn-ghost" type="button" :disabled="busy" @click="registerPasskey">Add passkey</button>
    </div>
    <Skeleton v-if="loading" label="Loading passkeys" :lines="2" />
    <div v-for="passkey in passkeys" :key="passkey.id" class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-800 p-3">
      <div>
        <div class="font-medium">{{ passkey.name }}</div>
        <div class="text-xs text-gray-500">{{ passkey.deviceType }} · {{ passkey.backedUp ? 'synced' : 'single device' }}</div>
      </div>
      <button class="btn-danger" type="button" :disabled="busy" @click="deletePasskey(passkey)">Delete</button>
    </div>
  </div>
</template>
