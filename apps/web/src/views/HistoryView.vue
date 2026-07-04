<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { diffLines, type Change } from 'diff'
import { useRoute, useRouter } from 'vue-router'
import { Api, type Page, type PageRevision } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const pagesStore = usePages()

const path = computed(() => paramToPath(route.params.path))
const page = ref<Page | null>(null)
const revisions = ref<PageRevision[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const restoring = ref(false)
const error = ref<string | null>(null)

const selectedIndex = computed(() =>
  revisions.value.findIndex((revision) => revision.id === selectedId.value),
)
const selectedRevision = computed(() =>
  selectedIndex.value >= 0 ? revisions.value[selectedIndex.value] : null,
)
const newerContent = computed(() => {
  if (!selectedRevision.value) return page.value?.content ?? ''
  if (selectedIndex.value <= 0) return page.value?.content ?? ''
  return revisions.value[selectedIndex.value - 1]?.content ?? ''
})
const diff = computed<Change[]>(() =>
  selectedRevision.value ? diffLines(selectedRevision.value.content, newerContent.value) : [],
)

const formatDate = (value: number): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [nextPage, nextRevisions] = await Promise.all([
      Api.getPage(path.value),
      Api.history(path.value),
    ])
    page.value = nextPage
    revisions.value = nextRevisions
    selectedId.value = nextRevisions[0]?.id ?? null
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function restore(): Promise<void> {
  const revision = selectedRevision.value
  if (!revision || !auth.canEdit) return
  restoring.value = true
  error.value = null
  try {
    await Api.updatePage(path.value, {
      title: revision.title,
      content: revision.content,
      description: revision.description,
    })
    await pagesStore.refresh()
    router.push('/' + path.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    restoring.value = false
  }
}

watch(path, load, { immediate: true })
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <RouterLink :to="'/' + path" class="link-quiet text-sm">Back to page</RouterLink>
        <h1 class="mt-2 text-3xl font-bold tracking-tight">History</h1>
        <p class="mt-1 font-mono text-sm text-gray-500">/{{ path }}</p>
      </div>
      <button
        v-if="auth.canEdit && selectedRevision"
        class="btn-primary"
        type="button"
        :disabled="restoring"
        @click="restore"
      >
        {{ restoring ? 'Restoring...' : 'Restore revision' }}
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <div v-if="loading" class="text-gray-400">Loading...</div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)] gap-5">
      <aside class="card p-2">
        <button
          v-for="revision in revisions"
          :key="revision.id"
          class="w-full text-left rounded-md px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800"
          :class="revision.id === selectedId ? 'bg-gray-100 dark:bg-gray-800' : ''"
          type="button"
          @click="selectedId = revision.id"
        >
          <div class="font-semibold capitalize">{{ revision.action }}</div>
          <div class="text-xs text-gray-500">{{ formatDate(revision.createdAt) }}</div>
          <div class="mt-1 text-xs font-mono text-gray-400 truncate">/{{ revision.path }}</div>
        </button>
        <p v-if="!revisions.length" class="p-3 text-sm text-gray-500">No revisions yet.</p>
      </aside>

      <section class="card overflow-hidden">
        <div class="border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <h2 class="font-semibold truncate">{{ selectedRevision?.title ?? page?.title ?? 'Current page' }}</h2>
            <p v-if="selectedRevision" class="text-xs text-gray-500">
              {{ formatDate(selectedRevision.createdAt) }}
            </p>
          </div>
          <div class="flex items-center gap-3 text-xs">
            <span class="text-green-600">Added</span>
            <span class="text-red-600">Removed</span>
          </div>
        </div>
        <pre class="m-0 max-h-[70vh] overflow-auto p-0 text-sm leading-6"><template v-for="(part, index) in diff" :key="index"><span
          :class="part.added ? 'history-added' : part.removed ? 'history-removed' : 'history-same'"
        >{{ part.value }}</span></template></pre>
      </section>
    </div>
  </div>
</template>
