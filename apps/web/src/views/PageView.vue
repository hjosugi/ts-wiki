<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref, watch, computed, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api, ApiClientError, type AssetView, type Page, type PageBacklink } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { onWikiEvent } from '@/lib/realtime'
import { usePresence } from '@/composables/usePresence'
import { useMarkdownFeatures } from '@/composables/useMarkdownFeatures'
import { vMarkdownEnhance } from '@/lib/markdownEnhance'
import { attachmentsForPage } from '@/lib/assets'
import { setPageMeta } from '@/lib/meta'
import EmptyState from '@/components/EmptyState.vue'
import InteractiveGraph from '@/components/InteractiveGraph.vue'
import PageComments from '@/components/PageComments.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageAttachments from '@/components/PageAttachments.vue'
import PageToc from '@/components/PageToc.vue'
import Skeleton from '@/components/Skeleton.vue'
import type { PageGraph } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useReadingPreferences } from '@/composables/useReadingPreferences'
import AppIcon from '@/components/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const { t } = useI18n()
const { markdownFeatures } = useMarkdownFeatures()
const reading = useReadingPreferences()
const readingFontSizes = ['small', 'medium', 'large'] as const
const GRAPH_PREFERENCE_KEY = 'kawaii-wiki:page-graph-visible'
const storedGraphPreference = typeof window === 'undefined' ? null : window.localStorage.getItem(GRAPH_PREFERENCE_KEY)
const graphVisible = ref(storedGraphPreference === null
  ? false
  : storedGraphPreference === 'true')
const graphLoading = ref(false)

const page = ref<Page | null>(null)
const graph = ref<PageGraph>({ nodes: [], edges: [] })
const backlinks = ref<PageBacklink[]>([])
const attachments = ref<AssetView[]>([])
const error = ref<string | null>(null)
const missing = ref(false)
const loading = ref(false)
const redirectedFrom = ref<string[]>([])
const homePath = ref('home')
const publicationNotice = computed(() => {
  if (page.value?.status === 'draft') return 'Draft — only editors can view this page.'
  const publishAt = page.value?.publishAt
  return publishAt && publishAt > Date.now() ? `Scheduled for ${new Date(publishAt).toLocaleString()}.` : ''
})

const path = computed(() => paramToPath(route.params.path) || homePath.value)
const routeRedirectedFrom = computed(() => typeof route.query.redirectedFrom === 'string' ? route.query.redirectedFrom : null)
const { viewers } = usePresence(path)
const editors = computed(() => viewers.value.filter((v) => v.mode === 'editing'))
const editorsLabel = computed(() => {
  const names = editors.value.map((v) => v.name)
  if (names.length === 1) return `${names[0]} is editing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are editing`
  return `${names.length} people editing`
})
const toc = computed(() => page.value?.toc ?? [])
const contentToc = computed(() => toc.value.filter((entry, index) => !(
  index === 0
  && entry.level === 1
  && entry.text.trim().toLocaleLowerCase() === page.value?.title.trim().toLocaleLowerCase()
)))
const renderedContent = computed(() => {
  const current = page.value
  if (!current || typeof document === 'undefined') return current?.renderedHtml ?? ''
  const template = document.createElement('template')
  template.innerHTML = current.renderedHtml
  const first = template.content.firstElementChild
  if (first?.tagName === 'H1' && first.textContent?.trim() === current.title.trim()) first.remove()
  return template.innerHTML
})

async function setGraphVisible(next: boolean): Promise<void> {
  graphVisible.value = next
  window.localStorage.setItem(GRAPH_PREFERENCE_KEY, String(next))
  if (!next || graph.value.nodes.length || graphLoading.value) return
  graphLoading.value = true
  try {
    graph.value = await Api.graph()
  } catch {
    graph.value = { nodes: [], edges: [] }
  } finally {
    graphLoading.value = false
  }
}

async function refreshPage(options: { showLoading: boolean; clearBefore?: boolean }): Promise<void> {
  if (options.showLoading) loading.value = true
  if (options.clearBefore) {
    error.value = null
    missing.value = false
    page.value = null
    graph.value = { nodes: [], edges: [] }
    backlinks.value = []
    attachments.value = []
    redirectedFrom.value = routeRedirectedFrom.value ? [routeRedirectedFrom.value] : []
  }
  try {
    const result = await Api.getPageResult(path.value)
    const loadGraph = options.showLoading && graphVisible.value
    const [nextGraph, nextBacklinks, nextUsage] = options.showLoading
      ? await Promise.all([
          loadGraph ? Api.graph().catch((): PageGraph => ({ nodes: [], edges: [] })) : Promise.resolve({ nodes: [], edges: [] } as PageGraph),
          Api.backlinks(result.page.path).catch(() => []),
          Api.assetUsage(result.page.path).catch(() => []),
        ])
      : [graph.value, backlinks.value, []]
    page.value = result.page
    missing.value = false
    graph.value = nextGraph
    backlinks.value = nextBacklinks
    if (options.showLoading) attachments.value = attachmentsForPage(nextUsage, result.page.path)
    setPageMeta(result.page)
    redirectedFrom.value = result.redirectedFrom.length ? [...result.redirectedFrom] : redirectedFrom.value
    if (result.redirectedFrom.length && result.page.path !== path.value) {
      await router.replace({ path: `/${result.page.path}`, query: { redirectedFrom: result.redirectedFrom[0] } })
    }
  } catch (e) {
    if (!options.showLoading) return
    page.value = null
    graph.value = { nodes: [], edges: [] }
    backlinks.value = []
    attachments.value = []
    missing.value = e instanceof ApiClientError && e.kind === 'not_found'
    error.value = missing.value ? null : friendlyError(e)
  } finally {
    if (options.showLoading) loading.value = false
  }
}

watch(path, () => refreshPage({ showLoading: true, clearBefore: true }), { immediate: true })

Api.publicSettings()
  .then((settings) => {
    homePath.value = settings.homePath || 'home'
  })
  .catch(() => {})

const stopRealtime = onWikiEvent((event) => {
  if (event.path === path.value || event.from === path.value) void refreshPage({ showLoading: false })
})
onUnmounted(stopRealtime)
</script>

<template>
  <Skeleton v-if="loading" :label="t('loading')" title :lines="5" />

  <div v-else-if="page" class="flex min-w-0 max-w-full gap-4 xl:gap-8">
    <article class="w-full min-w-0 flex-1">
      <PageHeader :page="page" :can-edit="auth.canEdit" :home-path="homePath" />
      <p v-if="publicationNotice" class="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        {{ publicationNotice }}
      </p>
      <p v-if="redirectedFrom.length" class="mb-4 text-sm text-gray-500">
        Redirected from /{{ redirectedFrom[0] }}
      </p>
      <div v-if="viewers.length > 1" class="page-presence flex items-center gap-2 -mt-2 mb-4">
        <div class="flex -space-x-2">
          <span
            v-for="(v, i) in viewers.slice(0, 5)"
            :key="i"
            :title="v.mode === 'editing' ? `${v.name} (editing)` : v.name"
            class="w-6 h-6 rounded-full text-white text-[11px] font-medium flex items-center justify-center ring-2 ring-white dark:ring-gray-950"
            :class="v.mode === 'editing' ? 'bg-amber-500' : 'bg-[var(--c-accent)]'"
          >
            {{ (v.name[0] ?? '?').toUpperCase() }}
          </span>
        </div>
        <span
          class="text-xs"
          :class="editors.length ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--c-text-muted)]'"
        >
          <template v-if="editors.length">✏ {{ editorsLabel }}</template>
          <template v-else>{{ viewers.length }} viewing now</template>
        </span>
      </div>
      <details
        v-if="contentToc.length"
        class="mb-4 xl:hidden"
      >
        <summary class="btn-ghost inline-flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-sm font-medium">
          <AppIcon name="book" :size="15" />
          {{ t('onThisPage') }}
        </summary>
        <div class="mt-2 max-w-xl rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
          <PageToc :entries="contentToc" :sticky="false" :show-title="false" />
        </div>
      </details>
      <div class="page-reading-controls mb-4 flex w-full min-w-0 items-center justify-end gap-2 text-xs text-[var(--c-text-muted)] print:hidden">
        <details class="relative">
          <summary class="btn-ghost inline-flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs">
            <AppIcon name="sliders" :size="15" />{{ t('reading') }}
          </summary>
          <div class="absolute right-0 z-20 mt-2 grid w-[min(18rem,calc(100vw-2rem))] gap-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3 shadow-xl">
            <div class="flex items-center justify-between gap-3">
              <span>{{ t('readingWidth') }}</span>
              <div class="inline-flex rounded border border-[var(--c-border)] p-0.5">
                <button class="rounded px-2 py-1" :class="reading.width.value === 'comfortable' ? 'bg-[var(--c-accent)] text-white' : ''" type="button" @click="reading.setWidth('comfortable')">{{ t('narrow') }}</button>
                <button class="rounded px-2 py-1" :class="reading.width.value === 'wide' ? 'bg-[var(--c-accent)] text-white' : ''" type="button" @click="reading.setWidth('wide')">{{ t('wide') }}</button>
              </div>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span>{{ t('readingFontSize') }}</span>
              <div class="inline-flex rounded border border-[var(--c-border)] p-0.5">
                <button v-for="size in readingFontSizes" :key="size" class="rounded px-2 py-1 capitalize" :class="reading.fontSize.value === size ? 'bg-[var(--c-accent)] text-white' : ''" type="button" @click="reading.setFontSize(size)">{{ size[0] }}</button>
              </div>
            </div>
          </div>
        </details>
        <button
          class="btn-ghost gap-1 px-2 py-1 text-xs"
          type="button"
          :aria-pressed="graphVisible"
          :title="graphVisible ? t('hideGraph') : t('showGraph')"
          @click="setGraphVisible(!graphVisible)"
        >
          <AppIcon name="graph" :size="16" />
          {{ graphVisible ? t('hideGraph') : t('showGraph') }}
        </button>
      </div>
      <div v-if="graphVisible" class="mb-5 xl:hidden">
        <Skeleton v-if="graphLoading" :label="t('loading')" :lines="3" />
        <InteractiveGraph v-else :graph="graph" :focus-path="page.path" compact />
      </div>
      <div
        v-markdown-enhance="markdownFeatures"
        class="prose dark:prose-invert"
        :class="[
          reading.width.value === 'comfortable' ? 'max-w-[72ch]' : 'max-w-none',
          reading.fontSize.value === 'small' ? 'text-sm' : reading.fontSize.value === 'large' ? 'text-lg' : 'text-base',
        ]"
        v-html="renderedContent"
      ></div>
      <PageAttachments :assets="attachments" />
      <section v-if="backlinks.length" class="mt-10 border-t border-gray-200 dark:border-gray-800 pt-5">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">{{ t('linkedFrom') }}</h2>
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

    <aside v-if="graphVisible || contentToc.length" class="page-rail hidden w-64 max-w-full shrink-0 space-y-6 xl:block">
      <InteractiveGraph v-if="graphVisible" :graph="graph" :focus-path="page.path" compact />
      <PageToc v-if="contentToc.length" :entries="contentToc" />
    </aside>
  </div>

  <section v-else-if="error" class="card mx-auto max-w-xl p-6 text-center">
    <h1 class="text-lg font-semibold">{{ t('couldNotLoadPage') }}</h1>
    <p class="mt-2 text-sm text-[var(--c-text-muted)]">{{ error }}</p>
    <button class="btn-primary mt-4" type="button" @click="refreshPage({ showLoading: true })">{{ t('retry') }}</button>
  </section>

  <EmptyState
    v-else-if="missing"
    :title="t('thisPageMissing')"
    :message="`/${path}`"
  >
    <template #actions>
      <RouterLink v-if="auth.canEdit" :to="{ name: 'new', query: { path } }" class="btn-primary">
        {{ t('createThisPage') }}
      </RouterLink>
      <RouterLink v-else to="/_login" class="btn-ghost">{{ t('signInCreate') }}</RouterLink>
    </template>
  </EmptyState>
</template>
