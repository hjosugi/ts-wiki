<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type AdminStats, type AnalyticsSummary } from '@/lib/api'

const stats = ref<AdminStats | null>(null)
const analytics = ref<AnalyticsSummary | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [nextStats, nextAnalytics] = await Promise.all([
      Api.adminStats(),
      Api.adminAnalytics(),
    ])
    stats.value = nextStats
    analytics.value = nextAnalytics
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="space-y-6">
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-if="loading" class="text-gray-400">Loading...</p>
    <div v-if="stats" class="grid grid-cols-3 gap-4 max-w-xl">
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
    <div v-if="analytics" class="max-w-xl">
      <h2 class="text-lg font-semibold mb-3">Insights</h2>
      <div class="card p-4">
        <div class="text-3xl font-bold">{{ analytics.totalViews }}</div>
        <div class="text-sm text-gray-400 mt-1">Total page views</div>
        <div v-if="analytics.topPages.length" class="mt-4 space-y-2">
          <RouterLink
            v-for="page in analytics.topPages"
            :key="page.path"
            :to="'/' + page.path"
            class="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <span class="truncate font-mono text-sm">/{{ page.path }}</span>
            <span class="text-sm text-gray-500">{{ page.views }}</span>
          </RouterLink>
        </div>
      </div>
    </div>
  </section>
</template>
