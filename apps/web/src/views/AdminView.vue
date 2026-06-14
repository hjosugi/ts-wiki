<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Api, type AdminUserView, type AdminStats } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()

const stats = ref<AdminStats | null>(null)
const users = ref<AdminUserView[]>([])
const error = ref<string | null>(null)
const loading = ref(true)

const ROLES = ['admin', 'editor', 'viewer'] as const
type RoleName = (typeof ROLES)[number]

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [s, u] = await Promise.all([Api.adminStats(), Api.adminUsers()])
    stats.value = s
    users.value = u
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function changeRole(user: AdminUserView, role: RoleName): Promise<void> {
  if (role === user.role) return
  const previous = user.role
  user.role = role // optimistic
  try {
    const updated = await Api.adminSetRole(user.id, role)
    user.role = updated.role
    if (stats.value) stats.value = await Api.adminStats()
  } catch (e) {
    user.role = previous // revert on failure
    error.value = (e as Error).message
  }
}

onMounted(() => {
  if (!auth.isAdmin) {
    router.replace('/')
    return
  }
  void load()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold tracking-tight mb-6">Admin</h1>
    <p v-if="error" class="text-sm text-red-600 mb-4">{{ error }}</p>
    <p v-if="loading" class="text-gray-400">Loading…</p>

    <!-- Stats -->
    <div v-if="stats" class="grid grid-cols-3 gap-4 mb-10 max-w-xl">
      <div class="card p-4">
        <div class="text-3xl font-bold">{{ stats.users }}</div>
        <div class="text-sm text-gray-400 mt-1">Users</div>
      </div>
      <div class="card p-4">
        <div class="text-3xl font-bold">{{ stats.pages }}</div>
        <div class="text-sm text-gray-400 mt-1">Pages</div>
      </div>
      <div class="card p-4">
        <div class="text-3xl font-bold">{{ stats.revisions }}</div>
        <div class="text-sm text-gray-400 mt-1">Revisions</div>
      </div>
    </div>

    <!-- Users -->
    <h2 class="text-lg font-semibold mb-3">Users</h2>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th class="p-3 font-medium">Name</th>
            <th class="p-3 font-medium">Email</th>
            <th class="p-3 font-medium w-44">Role</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in users"
            :key="u.id"
            class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
          >
            <td class="p-3 font-medium">{{ u.name }}</td>
            <td class="p-3 text-gray-500">{{ u.email }}</td>
            <td class="p-3">
              <select
                class="input py-1"
                :value="u.role"
                @change="changeRole(u, ($event.target as HTMLSelectElement).value as RoleName)"
              >
                <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
              </select>
              <span v-if="u.id === auth.user?.id" class="text-xs text-gray-400 ml-2">(you)</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
