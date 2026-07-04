<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { Api, type Page, type PageBacklink } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { onWikiEvent } from '@/lib/realtime'
import { usePresence } from '@/composables/usePresence'
import EmptyState from '@/components/EmptyState.vue'
import InteractiveGraph from '@/components/InteractiveGraph.vue'
import PageComments from '@/components/PageComments.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageToc from '@/components/PageToc.vue'
import type { PageGraph } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

const route = useRoute()
const auth = useAuth()
const { t } = useI18n()

const page = ref<Page | null>(null)
const graph = ref<PageGraph>({ nodes: [], edges: [] })
const backlinks = ref<PageBacklink[]>([])
const error = ref<string | null>(null)
const loading = ref(false)

const path = computed(() => paramToPath(route.params.path) || 'home')
const { viewers } = usePresence(path)
const editors = computed(() => viewers.value.filter((v) => v.mode === 'editing'))
const editorsLabel = computed(() => {
  const names = editors.value.map((v) => v.name)
  if (names.length === 1) return `${names[0]} is editing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are editing`
  return `${names.length} people editing`
})
const toc = computed<{ id: string; text: string; level: number }[]>(() => {
  try {
    return JSON.parse(page.value?.toc ?? '[]')
  } catch {
    return []
  }
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  page.value = null
  backlinks.value = []
  try {
    page.value = await Api.getPage(path.value)
    try {
      const [nextGraph, nextBacklinks] = await Promise.all([
        Api.graph(),
        Api.backlinks(path.value),
      ])
      graph.value = nextGraph
      backlinks.value = nextBacklinks
    } catch {
      graph.value = { nodes: [], edges: [] }
      backlinks.value = []
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

watch(path, load, { immediate: true })

// Realtime: when THIS page changes elsewhere, refresh it in place (no flash).
async function reloadInPlace(): Promise<void> {
  try {
    const [nextPage, nextBacklinks] = await Promise.all([
      Api.getPage(path.value),
      Api.backlinks(path.value),
    ])
    page.value = nextPage
    backlinks.value = nextBacklinks
  } catch {
    page.value = null // deleted or moved away → show the empty state
    backlinks.value = []
  }
}
const stopRealtime = onWikiEvent((event) => {
  if (event.path === path.value || event.from === path.value) void reloadInPlace()
})
onUnmounted(stopRealtime)
</script>

<template>
  <div v-if="loading" class="text-gray-400">{{ t('loading') }}</div>

  <div v-else-if="page" class="flex gap-8">
    <article class="flex-1 min-w-0">
      <PageHeader :page="page" :can-edit="auth.canEdit" />
      <div v-if="viewers.length > 1" class="flex items-center gap-2 -mt-2 mb-4">
        <div class="flex -space-x-2">
          <span
            v-for="(v, i) in viewers.slice(0, 5)"
            :key="i"
            :title="v.mode === 'editing' ? `${v.name} (editing)` : v.name"
            class="w-6 h-6 rounded-full text-white text-[11px] font-medium flex items-center justify-center ring-2 ring-white dark:ring-gray-950"
            :class="v.mode === 'editing' ? 'bg-amber-500' : 'bg-violet-500'"
          >
            {{ (v.name[0] ?? '?').toUpperCase() }}
          </span>
        </div>
        <span
          class="text-xs"
          :class="editors.length ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'"
        >
          <template v-if="editors.length">✏ {{ editorsLabel }}</template>
          <template v-else>{{ viewers.length }} viewing now</template>
        </span>
      </div>
      <div class="prose dark:prose-invert max-w-none" v-html="page.renderedHtml"></div>
      <section v-if="backlinks.length" class="mt-10 border-t border-gray-200 dark:border-gray-800 pt-5">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Linked from</h2>
        <div class="mt-3 flex flex-wrap gap-2">
          <RouterLink
            v-for="link in backlinks"
            :key="`${link.path}:${link.kind}`"
            :to="'/' + link.path"
            class="btn-ghost"
            :title="link.label"
          >
            {{ link.title }}
          </RouterLink>
        </div>
      </section>
      <PageComments :path="page.path" />
    </article>

    <aside class="hidden xl:block w-72 shrink-0 space-y-6">
      <InteractiveGraph :graph="graph" :focus-path="page.path" compact />
      <PageToc v-if="toc.length" :entries="toc" />
    </aside>
  </div>

  <EmptyState
    v-else
    :title="t('thisPageMissing')"
    :message="`/${path}`"
  >
    <template #actions>
      <RouterLink v-if="auth.canEdit" :to="{ name: 'new', query: { path } }" class="btn-primary">
        {{ t('createThisPage') }}
      </RouterLink>
      <RouterLink v-else to="/_login" class="btn-ghost">{{ t('signInCreate') }}</RouterLink>
    </template>
    <p v-if="error" class="text-xs text-gray-400 mt-4">{{ error }}</p>
  </EmptyState>
</template>
