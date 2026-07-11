<script setup lang="ts">
import { computed, ref } from 'vue'
import { Api, type AdminAuditEvent } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import Skeleton from '@/components/Skeleton.vue'
import { useAsyncData } from '@/composables/useAsyncData'
import AdminAsyncState from './AdminAsyncState.vue'

const { formatDateTime } = useI18n()
const events = ref<AdminAuditEvent[]>([])
const action = ref('')
const userId = ref('')
const from = ref('')
const to = ref('')
const limit = 50
const offset = ref(0)
const total = ref(0)
const requestedOffset = ref(0)

const hasPrevious = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + events.value.length < total.value)

function localDateTimeToMs(value: string): number | undefined {
  if (!value) return undefined
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : undefined
}

function compactData(event: AdminAuditEvent): string {
  const entries = Object.entries(event.data)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (!entries.length) return '-'
  return JSON.stringify(Object.fromEntries(entries))
}

const { loading, error, reload } = useAsyncData(async () => {
    const result = await Api.adminAudit({
      limit,
      offset: requestedOffset.value,
      ...(action.value.trim() ? { action: action.value.trim() } : {}),
      ...(userId.value.trim() ? { userId: userId.value.trim() } : {}),
      ...(localDateTimeToMs(from.value) !== undefined ? { from: localDateTimeToMs(from.value) } : {}),
      ...(localDateTimeToMs(to.value) !== undefined ? { to: localDateTimeToMs(to.value) } : {}),
    })
    events.value = result.events
    total.value = result.total
    offset.value = result.offset
    return result
})

async function load(nextOffset = offset.value): Promise<void> {
  requestedOffset.value = nextOffset
  await reload()
}

function applyFilters(): void {
  void load(0)
}

function previousPage(): void {
  if (hasPrevious.value) void load(Math.max(0, offset.value - limit))
}

function nextPage(): void {
  if (hasNext.value) void load(offset.value + limit)
}

</script>

<template>
  <section>
    <h2 class="mb-3 text-lg font-semibold">Audit log</h2>
    <AdminAsyncState :error="error" :loading="loading" @retry="load()" />
    <div class="card overflow-hidden">
      <form class="flex flex-wrap gap-2 border-b border-[var(--c-border)] p-3" @submit.prevent="applyFilters">
        <input v-model="action" class="input max-w-48" placeholder="action" aria-label="Audit action" />
        <input v-model="userId" class="input max-w-64" placeholder="user id" aria-label="Audit user id" />
        <input v-model="from" class="input max-w-56" type="datetime-local" aria-label="Audit from" />
        <input v-model="to" class="input max-w-56" type="datetime-local" aria-label="Audit to" />
        <button class="btn-primary" type="submit" :disabled="loading">Filter</button>
        <button class="btn-ghost" type="button" :disabled="loading" @click="load()">Refresh</button>
      </form>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-sm">
          <thead class="border-b border-[var(--c-border)] text-left text-[var(--c-text-muted)]">
            <tr>
              <th class="p-3 font-medium">Time</th>
              <th class="p-3 font-medium">Action</th>
              <th class="p-3 font-medium">User</th>
              <th class="p-3 font-medium">Path</th>
              <th class="p-3 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !events.length">
              <td class="p-3" colspan="5"><Skeleton label="Loading audit log" :lines="4" /></td>
            </tr>
            <tr v-else-if="!events.length">
              <td class="p-3 text-[var(--c-text-muted)]" colspan="5">No audit events.</td>
            </tr>
            <tr v-for="event in events" :key="event.id" class="border-b border-[var(--c-border)] last:border-0">
              <td class="whitespace-nowrap p-3 text-[var(--c-text-muted)]">{{ formatDateTime(event.createdAt) }}</td>
              <td class="p-3 font-mono text-xs">{{ event.action }}</td>
              <td class="p-3 font-mono text-xs text-[var(--c-text-muted)]">{{ event.userId || '-' }}</td>
              <td class="p-3 font-mono text-xs text-[var(--c-text-muted)]">{{ event.path || '-' }}</td>
              <td class="max-w-[28rem] truncate p-3 font-mono text-xs text-[var(--c-text-muted)]" :title="compactData(event)">
                {{ compactData(event) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--c-border)] p-3 text-sm text-[var(--c-text-muted)]">
        <span>{{ total }} events</span>
        <div class="flex gap-2">
          <button class="btn-ghost" type="button" :disabled="loading || !hasPrevious" @click="previousPage">Previous</button>
          <button class="btn-ghost" type="button" :disabled="loading || !hasNext" @click="nextPage">Next</button>
        </div>
      </div>
    </div>
  </section>
</template>
