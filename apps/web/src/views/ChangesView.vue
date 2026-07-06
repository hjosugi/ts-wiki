<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Api, type RecentChange } from '@/lib/api'

const changes = ref<RecentChange[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

// Group into day sections, newest day first, preserving newest-first order within.
const grouped = computed(() => {
  const map = new Map<string, RecentChange[]>()
  for (const change of changes.value) {
    const key = dayKey(change.createdAt)
    const list = map.get(key) ?? []
    list.push(change)
    map.set(key, list)
  }
  return [...map.entries()]
})

const actionClass = (action: string): string =>
  action === 'created'
    ? 'text-green-600'
    : action === 'deleted' || action === 'purged'
      ? 'text-red-600'
      : action === 'archived'
        ? 'text-amber-600'
        : 'text-violet-600'

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    changes.value = await Api.recentChanges(100)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Recent changes</h1>
        <p class="mt-1 text-sm text-gray-500">Latest edits across the wiki</p>
      </div>
      <button class="btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <div v-if="loading" class="text-gray-400">Loading...</div>

    <section v-for="[day, items] in grouped" :key="day" class="space-y-2">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">{{ day }}</h2>
      <ul class="card divide-y divide-gray-100 dark:divide-gray-800">
        <li v-for="change in items" :key="change.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
          <span class="w-16 shrink-0 text-xs text-gray-400">{{ formatTime(change.createdAt) }}</span>
          <span class="w-20 shrink-0 font-medium capitalize" :class="actionClass(change.action)">{{ change.action }}</span>
          <RouterLink class="link-quiet min-w-0 truncate" :to="'/' + change.path">{{ change.title || change.path }}</RouterLink>
          <span v-if="change.authorName" class="text-xs text-gray-400">by {{ change.authorName }}</span>
        </li>
      </ul>
    </section>

    <p v-if="!loading && !changes.length" class="text-gray-500">No changes yet.</p>
  </div>
</template>
