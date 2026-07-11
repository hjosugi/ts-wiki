<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api, type LabelCount, type PageSpace, type SearchHit } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useListNavigation, useSearch, type SearchFilters } from '@/composables/useSearch'
import Skeleton from '@/components/Skeleton.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const search = useSearch({ limit: 20, debounceMs: 180 })
const filtersOpen = ref(false)
const pathPrefix = ref('')
const label = ref('')
const status = ref('')
const spaceKey = ref('')
const locale = ref('')
const author = ref('')
const updatedAfter = ref('')
const updatedBefore = ref('')
const labels = ref<LabelCount[]>([])
const spaces = ref<PageSpace[]>([])

const statusOptions = ['draft', 'in-review', 'verified', 'outdated'] as const

const dateStart = (value: string): number | undefined => {
  if (!value) return undefined
  const ms = new Date(`${value}T00:00:00`).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

const dateEnd = (value: string): number | undefined => {
  if (!value) return undefined
  const ms = new Date(`${value}T23:59:59.999`).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

const dateInput = (value: unknown): string => {
  const ms = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''
}

const cleanString = (value: unknown): string => typeof value === 'string' ? value : ''

function currentFilters(): SearchFilters {
  return {
    pathPrefix: pathPrefix.value || undefined,
    label: label.value || undefined,
    status: status.value || undefined,
    spaceKey: spaceKey.value || undefined,
    locale: locale.value || undefined,
    author: author.value || undefined,
    updatedAfter: dateStart(updatedAfter.value),
    updatedBefore: dateEnd(updatedBefore.value),
  }
}

function syncFilters(): void {
  search.filters.value = currentFilters()
}

function queryForRoute(): Record<string, string | undefined> {
  return {
    q: search.q.value || undefined,
    scope: search.scope.value === 'title' ? 'title' : undefined,
    sort: search.sort.value === 'recent' ? 'recent' : undefined,
    pathPrefix: pathPrefix.value || undefined,
    label: label.value || undefined,
    status: status.value || undefined,
    spaceKey: spaceKey.value || undefined,
    locale: locale.value || undefined,
    author: author.value || undefined,
    updatedAfter: dateStart(updatedAfter.value)?.toString(),
    updatedBefore: dateEnd(updatedBefore.value)?.toString(),
  }
}

function applyRoute(): void {
  search.q.value = cleanString(route.query.q)
  search.scope.value = route.query.scope === 'title' ? 'title' : 'all'
  search.sort.value = route.query.sort === 'recent' ? 'recent' : 'relevance'
  pathPrefix.value = cleanString(route.query.pathPrefix)
  label.value = cleanString(route.query.label)
  status.value = cleanString(route.query.status)
  spaceKey.value = cleanString(route.query.spaceKey)
  locale.value = cleanString(route.query.locale)
  author.value = cleanString(route.query.author)
  updatedAfter.value = dateInput(route.query.updatedAfter)
  updatedBefore.value = dateInput(route.query.updatedBefore)
  filtersOpen.value = Boolean(pathPrefix.value || label.value || status.value || spaceKey.value || locale.value || author.value || updatedAfter.value || updatedBefore.value)
  syncFilters()
}

function onInput(): void {
  syncFilters()
  navigation.reset()
  void router.replace({ query: queryForRoute() })
  search.schedule()
}

function runNow(): void {
  syncFilters()
  navigation.reset()
  void router.replace({ query: queryForRoute() })
  void search.run()
}

function chooseLabel(next: string): void {
  label.value = label.value === next ? '' : next
  runNow()
}

function chooseRecent(query: string): void {
  search.q.value = query
  runNow()
}

const selectedHit = computed<SearchHit | null>(() => search.hits.value[navigation.selected.value] ?? null)

function coverStyle(hit: SearchHit): Record<string, string> {
  return hit.coverUrl
    ? {
        backgroundImage: `url(${JSON.stringify(hit.coverUrl)})`,
        backgroundPosition: hit.coverPosition || 'center',
      }
    : {}
}

function openSelected(): void {
  const hit = selectedHit.value
  if (!hit) return
  void router.push({ path: `/${hit.path}`, hash: hit.anchor ? `#${hit.anchor}` : '' })
}

const navigation = useListNavigation(computed(() => search.hits.value.length), openSelected)

watch(() => search.hits.value.length, () => navigation.reset())

const resultSummary = computed(() => {
  if (!search.q.value.trim() || search.loading.value) return ''
  return t(search.total.value === 1 ? 'oneSearchResult' : 'manySearchResults', { count: search.total.value })
})

onMounted(async () => {
  applyRoute()
  if (search.q.value.trim()) void search.run()
  try {
    const [nextLabels, nextSpaces] = await Promise.all([Api.labels(), Api.spaces()])
    labels.value = nextLabels
    spaces.value = nextSpaces
  } catch {
    labels.value = []
    spaces.value = []
  }
})
</script>

<template>
  <div class="max-w-4xl">
    <div class="mb-6 space-y-3">
      <div class="flex flex-col gap-2 sm:flex-row">
        <input
          v-model="search.q.value"
          class="input text-lg"
          :placeholder="t('searchTheWiki')"
          :aria-label="t('searchTheWiki')"
          role="combobox"
          aria-controls="search-results"
          :aria-expanded="Boolean(search.hits.value.length)"
          :aria-activedescendant="navigation.activeId('search-result')"
          @input="onInput"
          @keydown="navigation.onKeydown"
        />
        <div class="flex shrink-0 gap-2">
          <button
            class="btn-ghost"
            type="button"
            :class="search.scope.value === 'title' ? 'border-violet-400 text-violet-600' : ''"
            @click="search.scope.value = search.scope.value === 'title' ? 'all' : 'title'; runNow()"
          >
            {{ t('titleOnly') }}
          </button>
          <button
            class="btn-ghost"
            type="button"
            :class="search.sort.value === 'recent' ? 'border-violet-400 text-violet-600' : ''"
            @click="search.sort.value = search.sort.value === 'recent' ? 'relevance' : 'recent'; runNow()"
          >
            {{ t('recent') }}
          </button>
          <button class="btn-ghost" type="button" @click="filtersOpen = !filtersOpen">{{ t('filters') }}</button>
        </div>
      </div>

      <div v-if="!search.q.value.trim() && search.recentSearches.value.length" class="flex flex-wrap items-center gap-2 text-sm">
        <span class="text-gray-500">{{ t('recent') }}</span>
        <button
          v-for="recent in search.recentSearches.value"
          :key="recent"
          class="rounded-full border border-gray-200 px-3 py-1 text-gray-700 hover:border-violet-400 dark:border-gray-800 dark:text-gray-200"
          type="button"
          @click="chooseRecent(recent)"
        >
          {{ recent }}
        </button>
      </div>

      <div v-if="filtersOpen" class="rounded-md border border-gray-200 p-3 dark:border-gray-800">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input v-model.trim="pathPrefix" class="input text-sm" :placeholder="t('pathPrefix')" :aria-label="t('pathPrefix')" @input="onInput" />
          <select v-model="spaceKey" class="input text-sm" :aria-label="t('spaceFilter')" @change="runNow">
            <option value="">{{ t('anySpace') }}</option>
            <option v-for="space in spaces" :key="space.key" :value="space.key">{{ space.key }}</option>
          </select>
          <input v-model.trim="locale" class="input text-sm" :placeholder="t('locale')" :aria-label="t('locale')" @input="onInput" />
          <select v-model="status" class="input text-sm" :aria-label="t('pageStatus')" @change="runNow">
            <option value="">{{ t('anyStatus') }}</option>
            <option v-for="item in statusOptions" :key="item" :value="item">{{ item }}</option>
          </select>
          <input v-model.trim="author" class="input text-sm" :placeholder="t('author')" :aria-label="t('author')" @input="onInput" />
          <input v-model="updatedAfter" class="input text-sm" type="date" :aria-label="t('updatedAfter')" @change="runNow" />
          <input v-model="updatedBefore" class="input text-sm" type="date" :aria-label="t('updatedBefore')" @change="runNow" />
        </div>
        <div v-if="labels.length" class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="item in labels.slice(0, 24)"
            :key="item.label"
            class="rounded-full border px-3 py-1 text-sm"
            :class="label === item.label ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-100' : 'border-gray-200 text-gray-600 hover:border-violet-400 dark:border-gray-800 dark:text-gray-300'"
            type="button"
            @click="chooseLabel(item.label)"
          >
            {{ item.label }} <span class="text-xs text-[var(--c-text-muted)]">{{ item.count }}</span>
          </button>
        </div>
      </div>

      <details class="text-sm text-gray-500">
        <summary class="cursor-pointer">{{ t('searchSyntax') }}</summary>
        <p class="mt-2">
          {{ t('searchSyntaxDescription') }}
        </p>
      </details>
    </div>

    <div
      v-if="search.tokenizerHint.value || search.shortQueryHint.value"
      class="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <p v-if="search.tokenizerHint.value">{{ search.tokenizerHint.value.message }}</p>
      <p v-if="search.shortQueryHint.value">{{ search.shortQueryHint.value.message }}</p>
    </div>

    <p v-if="search.error.value" class="mb-4 text-sm text-red-600">{{ search.error.value }}</p>
    <Skeleton v-if="search.loading.value && !search.hits.value.length" :label="t('searching')" :lines="4" />
    <p v-else-if="search.q.value && !search.hits.value.length" class="text-gray-500">{{ t('noResults', { query: search.q.value }) }}</p>
    <p v-if="resultSummary" class="mb-3 text-sm text-gray-500">{{ resultSummary }}</p>

    <ul id="search-results" class="space-y-3" role="listbox">
      <li
        v-for="(h, index) in search.hits.value"
        :id="`search-result-${index}`"
        :key="`${h.path}:${h.anchor ?? ''}`"
        role="option"
        :aria-selected="index === navigation.selected.value"
        class="rounded-md border p-4 transition"
        :class="index === navigation.selected.value ? 'border-violet-400 bg-violet-50/60 dark:bg-violet-950/30' : 'border-gray-200 hover:border-violet-400 dark:border-gray-800'"
      >
        <RouterLink :to="{ path: '/' + h.path, hash: h.anchor ? '#' + h.anchor : '' }" class="grid gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
          <div
            class="grid h-16 w-18 shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--c-surface-muted)] bg-cover text-2xl"
            :style="coverStyle(h)"
            aria-hidden="true"
          >
            <span v-if="!h.coverUrl && h.icon">{{ h.icon }}</span>
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="h.icon && h.coverUrl" aria-hidden="true">{{ h.icon }}</span>
              <span class="font-semibold text-violet-600">{{ h.title }}</span>
              <span v-if="h.kind !== 'page'" class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {{ h.kind === 'comment' ? t('inComments') : t('inAssets') }}
              </span>
            </div>
            <div class="mb-1 font-mono text-xs text-gray-500">/{{ h.path }}</div>
            <div class="search-snippet text-sm text-gray-700 dark:text-gray-300" v-html="h.snippet"></div>
          </div>
        </RouterLink>
      </li>
    </ul>

    <button v-if="search.hasMore.value" class="btn-ghost mt-4" type="button" :disabled="search.loading.value" @click="search.loadMore">
      {{ search.loading.value ? t('loading') : t('loadMore') }}
    </button>
  </div>
</template>

<style>
.search-snippet mark {
  background: rgba(139, 92, 246, 0.25);
  color: inherit;
  border-radius: 2px;
  padding: 0 2px;
}
</style>
