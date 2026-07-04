<script setup lang="ts">
import { ref } from 'vue'
import { Api } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const name = ref(auth.user?.name ?? '')
const currentPassword = ref('')
const newPassword = ref('')
const busy = ref(false)
const message = ref<string | null>(null)
const error = ref<string | null>(null)

async function saveProfile(): Promise<void> {
  busy.value = true
  message.value = null
  error.value = null
  try {
    auth.user = await Api.updateProfile({ name: name.value })
    name.value = auth.user.name
    message.value = 'Profile updated'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function savePassword(): Promise<void> {
  busy.value = true
  message.value = null
  error.value = null
  try {
    auth.user = await Api.changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    currentPassword.value = ''
    newPassword.value = ''
    message.value = 'Password updated'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="font-medium">Profile</h3>
        <p class="text-sm text-gray-500">{{ auth.user?.email }}</p>
      </div>
      <button class="btn-ghost" type="button" :disabled="busy || !name.trim()" @click="saveProfile">Save</button>
    </div>
    <input v-model="name" class="input" placeholder="Display name" />

    <div class="grid sm:grid-cols-2 gap-2">
      <input v-model="currentPassword" class="input" type="password" placeholder="Current password" autocomplete="current-password" />
      <input v-model="newPassword" class="input" type="password" placeholder="New password" autocomplete="new-password" />
    </div>
    <button
      class="btn-primary"
      type="button"
      :disabled="busy || !currentPassword || newPassword.length < 6"
      @click="savePassword"
    >
      Change password
    </button>
    <p v-if="message" class="text-sm text-emerald-600">{{ message }}</p>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
  </div>
</template>
