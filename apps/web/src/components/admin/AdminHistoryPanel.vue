<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref } from 'vue'
import { Api, type AdminHistoryStats, type PurgeHistoryResult } from '@/lib/api'
import { useDialogs } from '@/composables/useDialogs'
import { useAsyncData } from '@/composables/useAsyncData'
import AdminAsyncState from './AdminAsyncState.vue'

const { data: stats, loading, error, reload: load } = useAsyncData<AdminHistoryStats | null>(Api.adminHistoryStats, { initial: null })
const lastPurge = ref<PurgeHistoryResult | null>(null)
const olderThanDays = ref(90)
const keepLatest = ref(5)
const purging = ref(false)
const dialogs = useDialogs()

const formatBytes = (value: number): string =>
  value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(value / 1024))} KB`

async function purge(): Promise<void> {
  if (!await dialogs.confirm({ message: `Purge revisions older than ${olderThanDays.value} days while keeping ${keepLatest.value} per page?`, danger: true })) return
  purging.value = true
  error.value = null
  try {
    lastPurge.value = await Api.adminPurgeHistory({
      olderThanDays: olderThanDays.value,
      keepLatest: keepLatest.value,
    })
    stats.value = {
      revisions: lastPurge.value.revisions,
      historyBytes: lastPurge.value.historyBytes,
    }
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    purging.value = false
  }
}

</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">History maintenance</h2>
    <AdminAsyncState :error="error" :loading="loading" @retry="load" />
    <div class="card p-4 max-w-2xl">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div class="text-2xl font-bold">{{ stats?.revisions ?? 0 }}</div>
          <div class="text-sm text-[var(--c-text-muted)]">Revisions</div>
        </div>
        <div>
          <div class="text-2xl font-bold">{{ formatBytes(stats?.historyBytes ?? 0) }}</div>
          <div class="text-sm text-[var(--c-text-muted)]">History data</div>
        </div>
        <label class="block">
          <span class="text-xs font-medium text-gray-500">Older than days</span>
          <input v-model.number="olderThanDays" class="input mt-1 h-9" type="number" min="1" />
        </label>
        <label class="block">
          <span class="text-xs font-medium text-gray-500">Keep per page</span>
          <input v-model.number="keepLatest" class="input mt-1 h-9" type="number" min="0" />
        </label>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button class="btn-danger" type="button" :disabled="purging || loading" @click="purge">
          {{ purging ? 'Purging...' : 'Purge old history' }}
        </button>
        <button class="btn-ghost" type="button" :disabled="loading" @click="load">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
        <span v-if="lastPurge" class="text-sm text-gray-500">
          Deleted {{ lastPurge.deleted }} revision{{ lastPurge.deleted === 1 ? '' : 's' }}.
        </span>
      </div>
    </div>
  </section>
</template>
