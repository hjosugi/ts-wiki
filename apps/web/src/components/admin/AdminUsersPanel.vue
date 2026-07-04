<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type AdminStats, type AdminUserView } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const users = ref<AdminUserView[]>([])
const stats = ref<AdminStats | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const ROLES = ['admin', 'editor', 'viewer'] as const
type RoleName = (typeof ROLES)[number]

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [nextUsers, nextStats] = await Promise.all([Api.adminUsers(), Api.adminStats()])
    users.value = nextUsers
    stats.value = nextStats
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function changeRole(user: AdminUserView, role: RoleName): Promise<void> {
  if (role === user.role) return
  const previous = user.role
  user.role = role
  error.value = null
  try {
    const updated = await Api.adminSetRole(user.id, role)
    user.role = updated.role
    stats.value = await Api.adminStats()
  } catch (e) {
    user.role = previous
    error.value = (e as Error).message
  }
}

async function removeUserFromGroup(user: AdminUserView, groupKey: string): Promise<void> {
  error.value = null
  try {
    await Api.adminRemoveUserFromGroup(user.id, groupKey)
    users.value = await Api.adminUsers()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function resetPassword(user: AdminUserView): Promise<void> {
  const password = prompt(`New password for ${user.email}`)
  if (!password) return
  error.value = null
  try {
    const updated = await Api.adminSetPassword(user.id, password)
    Object.assign(user, updated)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deactivateUser(user: AdminUserView): Promise<void> {
  if (user.disabledAt || !confirm(`Deactivate ${user.email}?`)) return
  error.value = null
  try {
    const updated = await Api.adminDeactivateUser(user.id)
    Object.assign(user, updated)
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Users</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="loading" class="text-gray-400 mb-3">Loading...</p>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th class="p-3 font-medium">Name</th>
            <th class="p-3 font-medium">Email</th>
            <th class="p-3 font-medium">Groups</th>
            <th class="p-3 font-medium w-44">Role</th>
            <th class="p-3 font-medium w-48">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
            <td class="p-3 font-medium">
              {{ u.name }}
              <span v-if="u.disabledAt" class="ml-2 text-xs text-red-500">disabled</span>
            </td>
            <td class="p-3 text-gray-500">{{ u.email }}</td>
            <td class="p-3">
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="group in u.groups"
                  :key="group"
                  class="rounded border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs text-gray-500"
                  type="button"
                  title="Remove from group"
                  @click="removeUserFromGroup(u, group)"
                >
                  {{ group }} x
                </button>
              </div>
            </td>
            <td class="p-3">
              <select class="input py-1" :value="u.role" @change="changeRole(u, ($event.target as HTMLSelectElement).value as RoleName)">
                <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
              </select>
              <span v-if="u.id === auth.user?.id" class="text-xs text-gray-400 ml-2">(you)</span>
            </td>
            <td class="p-3">
              <div class="flex flex-wrap gap-2">
                <button class="btn-ghost py-1 text-xs" type="button" @click="resetPassword(u)">Reset password</button>
                <button
                  class="btn-danger py-1 text-xs"
                  type="button"
                  :disabled="Boolean(u.disabledAt) || u.id === auth.user?.id"
                  @click="deactivateUser(u)"
                >
                  Deactivate
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
