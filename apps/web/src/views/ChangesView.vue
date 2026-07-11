<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref, computed } from 'vue'
import { Api, type RecentChange } from '@/lib/api'
import { API_BASE_URL } from '@/lib/url'
import Skeleton from '@/components/Skeleton.vue'
import { useAsyncData } from '@/composables/useAsyncData'
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()

const PAGE_SIZE = 50
const changes = ref<RecentChange[]>([])
const loadingMore = ref(false)
const hasMore = ref(false)
const feedUrl = `${API_BASE_URL.replace(/\/+$/, '')}/feed.xml`

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
    ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-200'
    : action === 'deleted' || action === 'purged'
      ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200'
      : action === 'archived'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200'
        : 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200'

const { loading, error, reload: load } = useAsyncData(async () => {
  const next = await Api.recentChanges(PAGE_SIZE)
  changes.value = next
  hasMore.value = next.length === PAGE_SIZE
})

async function loadMore(): Promise<void> {
  const before = changes.value.at(-1)?.createdAt
  if (!before) return
  loadingMore.value = true
  error.value = null
  try {
    const older = await Api.recentChanges(PAGE_SIZE, before)
    changes.value = [...changes.value, ...older]
    hasMore.value = older.length === PAGE_SIZE
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loadingMore.value = false
  }
}

</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">{{ t('recentChanges') }}</h1>
        <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('latestEdits') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <a class="btn-ghost" :href="feedUrl" target="_blank" rel="noopener">Atom</a>
        <button class="btn-ghost" type="button" :disabled="loading" @click="load">{{ t('refresh') }}</button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <Skeleton v-if="loading" :label="t('loadingChanges')" :lines="5" />

    <section v-for="[day, items] in grouped" :key="day" class="space-y-2">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">{{ day }}</h2>
      <ul class="card divide-y divide-gray-100 dark:divide-gray-800">
        <li v-for="change in items" :key="change.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
          <span class="w-16 shrink-0 text-xs text-[var(--c-text-muted)]">{{ formatTime(change.createdAt) }}</span>
          <span class="w-20 shrink-0 rounded px-2 py-0.5 text-center text-xs font-semibold capitalize" :class="actionClass(change.action)">{{ change.action }}</span>
          <RouterLink class="link-quiet min-w-0 truncate" :to="'/' + change.path">{{ change.title || change.path }}</RouterLink>
          <span v-if="change.authorName" class="text-xs text-[var(--c-text-muted)]">{{ t('byAuthor', { name: change.authorName }) }}</span>
          <RouterLink class="ml-auto text-xs link-quiet" :to="'/_history/' + change.path">{{ t('history') }}</RouterLink>
        </li>
      </ul>
    </section>

    <button
      v-if="hasMore"
      class="btn-ghost"
      type="button"
      :disabled="loadingMore"
      @click="loadMore"
    >
      {{ loadingMore ? t('loading') : t('loadOlderChanges') }}
    </button>

    <p v-if="!loading && !changes.length" class="text-gray-500">{{ t('noChangesYet') }}</p>
  </div>
</template>
