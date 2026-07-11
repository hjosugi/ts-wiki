<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { computed, ref } from 'vue'
import { Api, type AdminPageView, type Page } from '@/lib/api'
import { usePages } from '@/stores/pages'
import { useI18n } from '@/lib/i18n'
import Skeleton from '@/components/Skeleton.vue'
import { useDialogs } from '@/composables/useDialogs'
import { useAsyncData } from '@/composables/useAsyncData'
import AdminAsyncState from './AdminAsyncState.vue'

const PAGE_SIZE = 25
const STATUS_OPTIONS: Array<Page['status']> = ['draft', 'in-review', 'verified', 'outdated']

const pages = ref<AdminPageView[]>([])
const total = ref(0)
const offset = ref(0)
const status = ref('')
const label = ref('')
const spaceKey = ref('')
const authorId = ref('')
const pagesStore = usePages()
const { formatDateTime } = useI18n()
const dialogs = useDialogs()

const pageNumber = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const canPrev = computed(() => offset.value > 0)
const canNext = computed(() => offset.value + PAGE_SIZE < total.value)

const labelsFor = (page: AdminPageView): string[] => page.labels

const { loading, error, reload } = useAsyncData(async () => {
    const result = await Api.adminPages({
      limit: PAGE_SIZE,
      offset: offset.value,
      status: status.value || undefined,
      label: label.value || undefined,
      spaceKey: spaceKey.value || undefined,
      authorId: authorId.value || undefined,
    })
    pages.value = result.pages
    total.value = result.total
    offset.value = result.offset
    return result
})

async function load(reset = false): Promise<void> {
  if (reset) offset.value = 0
  await reload()
}

async function archivePage(page: AdminPageView): Promise<void> {
  if (!await dialogs.confirm({ message: `Archive "/${page.path}"?` })) return
  error.value = null
  try {
    await Api.archivePage(page.path)
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function deletePage(page: AdminPageView): Promise<void> {
  if (!await dialogs.confirm({ message: `Move "/${page.path}" to trash?`, danger: true })) return
  error.value = null
  try {
    await Api.deletePage(page.path)
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = friendlyError(e)
  }
}

function previousPage(): void {
  if (!canPrev.value) return
  offset.value = Math.max(0, offset.value - PAGE_SIZE)
  void load()
}

function nextPage(): void {
  if (!canNext.value) return
  offset.value += PAGE_SIZE
  void load()
}

</script>

<template>
  <section>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">Pages</h2>
      <button class="btn-ghost" type="button" :disabled="loading" @click="load()">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </div>
    <form class="mb-3 flex flex-wrap items-center gap-2" @submit.prevent="load(true)">
      <select v-model="status" class="input h-9 w-40 text-sm" aria-label="Page status">
        <option value="">Any status</option>
        <option v-for="option in STATUS_OPTIONS" :key="option" :value="option">{{ option }}</option>
      </select>
      <input v-model.trim="label" class="input h-9 w-44 text-sm" placeholder="Label" aria-label="Label" />
      <input v-model.trim="spaceKey" class="input h-9 w-44 text-sm" placeholder="Space" aria-label="Space" />
      <input v-model.trim="authorId" class="input h-9 w-56 text-sm" placeholder="Author user id" aria-label="Author user ID" />
      <button class="btn-primary" type="submit" :disabled="loading">Apply</button>
    </form>
    <AdminAsyncState :error="error" :loading="loading" @retry="load()" />
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-[var(--c-text-muted)] border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th class="p-3 font-medium">Page</th>
            <th class="p-3 font-medium">Status</th>
            <th class="p-3 font-medium">Labels</th>
            <th class="p-3 font-medium">Author</th>
            <th class="p-3 font-medium">Updated</th>
            <th class="p-3 font-medium w-60">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !pages.length">
            <td class="p-3" colspan="6"><Skeleton label="Loading pages" :lines="3" /></td>
          </tr>
          <tr v-else-if="!pages.length">
            <td class="p-3 text-gray-500" colspan="6">No pages match these filters.</td>
          </tr>
          <tr v-for="page in pages" :key="page.path" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
            <td class="p-3">
              <div class="font-medium">{{ page.title }}</div>
              <div class="text-xs font-mono text-gray-500">/{{ page.path }}</div>
              <div class="mt-1 text-xs text-[var(--c-text-muted)]">{{ page.spaceKey }} · {{ page.locale }}</div>
            </td>
            <td class="p-3">
              <span class="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {{ page.status }}
              </span>
            </td>
            <td class="p-3">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="item in labelsFor(page)"
                  :key="item"
                  class="accent-chip rounded px-2 py-0.5 text-xs"
                >
                  #{{ item }}
                </span>
                <span v-if="!labelsFor(page).length" class="text-xs text-[var(--c-text-muted)]">None</span>
              </div>
            </td>
            <td class="p-3 text-gray-500">
              <div>{{ page.authorName || 'Unknown' }}</div>
              <div v-if="page.authorId" class="text-xs font-mono">{{ page.authorId }}</div>
            </td>
            <td class="p-3 text-gray-500">{{ formatDateTime(page.updatedAt) }}</td>
            <td class="p-3">
              <div class="flex flex-wrap gap-2">
                <RouterLink class="btn-ghost py-1 text-xs" :to="'/' + page.path">View</RouterLink>
                <RouterLink class="btn-ghost py-1 text-xs" :to="'/_edit/' + page.path">Edit</RouterLink>
                <button class="btn-ghost py-1 text-xs" type="button" @click="archivePage(page)">Archive</button>
                <button class="btn-danger py-1 text-xs" type="button" @click="deletePage(page)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
      <span>{{ total }} pages · page {{ pageNumber }}</span>
      <div class="flex gap-2">
        <button class="btn-ghost" type="button" :disabled="!canPrev || loading" @click="previousPage">Previous</button>
        <button class="btn-ghost" type="button" :disabled="!canNext || loading" @click="nextPage">Next</button>
      </div>
    </div>
  </section>
</template>
