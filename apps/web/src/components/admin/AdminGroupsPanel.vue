<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type AdminUserView, type AuthzGroupView } from '@/lib/api'

const users = ref<AdminUserView[]>([])
const groups = ref<AuthzGroupView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const groupKey = ref('')
const groupName = ref('')
const groupDescription = ref('')
const membershipGroup = ref('viewers')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [nextUsers, nextGroups] = await Promise.all([Api.adminUsers(), Api.adminGroups()])
    users.value = nextUsers
    groups.value = nextGroups
    membershipGroup.value = nextGroups[0]?.key ?? 'viewers'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function createGroup(): Promise<void> {
  error.value = null
  try {
    const group = await Api.adminCreateGroup({ key: groupKey.value, name: groupName.value, description: groupDescription.value })
    groups.value = [...groups.value, group].sort((a, b) => a.key.localeCompare(b.key))
    groupKey.value = ''
    groupName.value = ''
    groupDescription.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function addUserToGroup(user: AdminUserView): Promise<void> {
  if (!membershipGroup.value) return
  error.value = null
  try {
    await Api.adminAddUserToGroup({ userId: user.id, groupKey: membershipGroup.value })
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Groups</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="loading" class="text-gray-400 mb-3">Loading...</p>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <tr><th class="p-3 font-medium">Group</th><th class="p-3 font-medium">Description</th><th class="p-3 font-medium">Members</th></tr>
          </thead>
          <tbody>
            <tr v-for="group in groups" :key="group.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
              <td class="p-3"><div class="font-medium">{{ group.name }}</div><div class="text-xs font-mono text-gray-500">{{ group.key }}</div></td>
              <td class="p-3 text-gray-500">{{ group.description }}</td>
              <td class="p-3 text-gray-500">{{ group.members }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="space-y-3">
        <form class="card p-4 space-y-2" @submit.prevent="createGroup">
          <input v-model="groupKey" class="input" placeholder="group-key" />
          <input v-model="groupName" class="input" placeholder="Group name" />
          <input v-model="groupDescription" class="input" placeholder="Description" />
          <button class="btn-primary" type="submit" :disabled="!groupKey || !groupName">Create group</button>
        </form>
        <div class="card p-4 space-y-2">
          <select v-model="membershipGroup" class="input">
            <option v-for="group in groups" :key="group.key" :value="group.key">{{ group.key }}</option>
          </select>
          <div class="flex flex-wrap gap-2">
            <button v-for="u in users" :key="u.id" class="btn-ghost" type="button" @click="addUserToGroup(u)">Add {{ u.name }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
