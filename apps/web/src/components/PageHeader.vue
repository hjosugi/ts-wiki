<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Api, type Page, type PageInsight, type PageShareView } from '@/lib/api'
import WikiBreadcrumbs from '@/components/WikiBreadcrumbs.vue'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  page: Page
  canEdit: boolean
  homePath?: string
}>()

const copied = ref(false)
const share = ref<PageShareView | null>(null)
const shareBusy = ref(false)
const shareMessage = ref<string | null>(null)
const shareError = ref<string | null>(null)
const insightsOpen = ref(false)
const insightsLoading = ref(false)
const insightsError = ref<string | null>(null)
const insights = ref<PageInsight | null>(null)
const { formatDate, formatDateTime, t } = useI18n()

const updated = computed(() =>
  formatDateTime(props.page.updatedAt),
)
const coverStyle = computed(() =>
  props.page.coverUrl
    ? {
        backgroundImage: `url(${JSON.stringify(props.page.coverUrl)})`,
        backgroundPosition: props.page.coverPosition || 'center',
      }
    : {},
)

const childPath = computed(() => `${props.page.path}/new-page`)
const markdownExportUrl = computed(() => `/api/export/page?path=${encodeURIComponent(props.page.path)}&format=markdown`)
const htmlExportUrl = computed(() => `/api/export/page?path=${encodeURIComponent(props.page.path)}&format=html`)
const labels = computed<string[]>(() => {
  try {
    const parsed = JSON.parse(props.page.labels) as unknown
    return Array.isArray(parsed) ? parsed.filter((label): label is string => typeof label === 'string') : []
  } catch {
    return []
  }
})
const reviewDate = computed(() =>
  props.page.reviewAt ? formatDate(props.page.reviewAt) : null,
)
const shareUrl = computed(() =>
  share.value ? `${window.location.origin}/_share/${encodeURIComponent(share.value.token)}` : '',
)
const plainText = computed(() =>
  props.page.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/[#>*_~|[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim(),
)
const readingStats = computed(() => {
  const text = plainText.value
  const cjkChars = text.match(/[\u3040-\u30ff\u3400-\u9fff]/g)?.length ?? 0
  const latinWords = text
    .replace(/[\u3040-\u30ff\u3400-\u9fff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0
  const wordLikeCount = latinWords + cjkChars
  const readingUnits = latinWords + Math.ceil(cjkChars / 2)
  return {
    words: wordLikeCount,
    minutes: Math.max(1, Math.ceil(readingUnits / 220)),
  }
})

async function loadShare(): Promise<void> {
  if (!props.canEdit) {
    share.value = null
    return
  }
  try {
    share.value = await Api.currentPageShare(props.page.path)
  } catch {
    share.value = null
  }
}

async function loadInsights(): Promise<void> {
  insightsLoading.value = true
  insightsError.value = null
  try {
    insights.value = await Api.pageInsights(props.page.path)
  } catch (e) {
    insightsError.value = (e as Error).message
  } finally {
    insightsLoading.value = false
  }
}

async function toggleInsights(): Promise<void> {
  insightsOpen.value = !insightsOpen.value
  if (insightsOpen.value && !insights.value && !insightsLoading.value) await loadInsights()
}

async function copyPath(): Promise<void> {
  await navigator.clipboard?.writeText('/' + props.page.path)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1200)
}

async function copyShareLink(): Promise<void> {
  if (!shareUrl.value) return
  const canCopy = Boolean(navigator.clipboard?.writeText)
  if (canCopy) await navigator.clipboard.writeText(shareUrl.value)
  shareMessage.value = canCopy ? t('shareLinkCopied') : shareUrl.value
  shareError.value = null
}

async function createShareLink(): Promise<void> {
  shareBusy.value = true
  shareError.value = null
  try {
    share.value = await Api.createPageShare(props.page.path)
    shareMessage.value = t('shareReady')
    await copyShareLink()
  } catch (e) {
    shareError.value = (e as Error).message
  } finally {
    shareBusy.value = false
  }
}

async function revokeShareLink(): Promise<void> {
  if (!share.value) return
  shareBusy.value = true
  shareError.value = null
  try {
    await Api.revokePageShare(share.value.token)
    share.value = null
    shareMessage.value = null
  } catch (e) {
    shareError.value = (e as Error).message
  } finally {
    shareBusy.value = false
  }
}

watch(() => [props.page.path, props.canEdit] as const, () => {
  shareMessage.value = null
  shareError.value = null
  insightsOpen.value = false
  insights.value = null
  insightsError.value = null
  void loadShare()
}, { immediate: true })
</script>

<template>
  <header class="border-b border-gray-200 dark:border-gray-800 pb-5 mb-7">
    <div
      v-if="page.coverUrl"
      class="mb-5 h-48 overflow-hidden rounded-md bg-[var(--c-surface-muted)] bg-cover sm:h-64"
      :style="coverStyle"
      aria-hidden="true"
    ></div>
    <WikiBreadcrumbs :path="page.path" :home-path="homePath" :current-icon="page.icon" />

    <div class="flex flex-wrap items-start justify-between gap-4 mt-3">
      <div class="min-w-0">
        <h1 class="flex min-w-0 items-center gap-3 text-3xl font-bold tracking-tight text-gray-950 dark:text-gray-50">
          <span v-if="page.icon" class="shrink-0 text-4xl leading-none" aria-hidden="true">{{ page.icon }}</span>
          <span class="min-w-0 break-words">{{ page.title }}</span>
        </h1>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-[var(--c-text-muted)]">
          <span class="font-mono">/{{ page.path }}</span>
          <span>{{ t('space', { space: page.spaceKey }) }}</span>
          <span>{{ t('locale') }} {{ page.locale }}</span>
          <span>{{ t('updated', { date: updated }) }}</span>
          <span class="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold capitalize text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {{ page.status }}
          </span>
          <span v-if="reviewDate">{{ t('review', { date: reviewDate }) }}</span>
        </div>
        <div v-if="labels.length" class="mt-3 flex flex-wrap gap-1.5">
          <RouterLink
            v-for="label in labels"
            :key="label"
            :to="{ name: 'search', query: { q: label, label } }"
            class="rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-200"
          >
            #{{ label }}
          </RouterLink>
        </div>
      </div>

      <div class="shrink-0 space-y-2">
        <div class="flex flex-wrap justify-end gap-2">
          <button class="btn-ghost" type="button" @click="copyPath">
            {{ copied ? t('copied') : t('copyPath') }}
          </button>
          <button
            class="btn-ghost"
            type="button"
            :aria-expanded="insightsOpen"
            aria-controls="page-insights"
            @click="toggleInsights"
          >
            Insights
          </button>
          <button
            v-if="canEdit"
            class="btn-ghost"
            type="button"
            :disabled="shareBusy"
            @click="share ? copyShareLink() : createShareLink()"
          >
            {{ share ? t('copyShareLink') : t('share') }}
          </button>
          <button
            v-if="canEdit && share"
            class="btn-ghost"
            type="button"
            :disabled="shareBusy"
            @click="revokeShareLink"
          >
            {{ t('revokeShare') }}
          </button>
          <RouterLink v-if="canEdit" :to="{ name: 'new', query: { path: childPath } }" class="btn-ghost">
            {{ t('newChild') }}
          </RouterLink>
          <RouterLink :to="'/_history/' + page.path" class="btn-ghost">
            {{ t('history') }}
          </RouterLink>
          <a class="btn-ghost" :href="markdownExportUrl">{{ t('markdown') }}</a>
          <a class="btn-ghost" :href="htmlExportUrl">{{ t('html') }}</a>
          <RouterLink v-if="canEdit" :to="'/_edit/' + page.path" class="btn-primary">
            {{ t('edit') }}
          </RouterLink>
        </div>
        <p v-if="shareError" class="text-right text-xs text-red-600">{{ shareError }}</p>
        <p v-else-if="shareMessage" class="text-right text-xs text-gray-500">{{ shareMessage }}</p>
        <div
          v-if="insightsOpen"
          id="page-insights"
          class="ml-auto max-w-md rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm shadow-sm"
        >
          <p v-if="insightsError" class="text-red-600">{{ insightsError }}</p>
          <p v-else-if="insightsLoading" class="text-[var(--c-text-muted)]">Loading insights...</p>
          <div v-else class="grid gap-3">
            <div class="grid grid-cols-3 gap-2 text-center">
              <div class="rounded-md bg-[var(--c-surface-muted)] px-2 py-2">
                <span class="block text-lg font-semibold">{{ insights?.views ?? 0 }}</span>
                <span class="text-xs text-[var(--c-text-muted)]">Views</span>
              </div>
              <div class="rounded-md bg-[var(--c-surface-muted)] px-2 py-2">
                <span class="block text-lg font-semibold">{{ readingStats.minutes }}m</span>
                <span class="text-xs text-[var(--c-text-muted)]">{{ readingStats.words }} words</span>
              </div>
              <div class="rounded-md bg-[var(--c-surface-muted)] px-2 py-2">
                <span class="block text-lg font-semibold">{{ insights?.revisionCount ?? 0 }}</span>
                <span class="text-xs text-[var(--c-text-muted)]">Revisions</span>
              </div>
            </div>
            <p v-if="insights?.lastViewedAt" class="text-xs text-[var(--c-text-muted)]">
              Last viewed {{ formatDateTime(insights.lastViewedAt) }}
            </p>
            <div>
              <h2 class="mb-1 text-xs font-semibold uppercase text-[var(--c-text-muted)]">Contributors</h2>
              <ul v-if="insights?.contributors.length" class="space-y-1">
                <li
                  v-for="contributor in insights.contributors"
                  :key="contributor.authorId ?? 'unknown'"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="min-w-0 truncate">{{ contributor.authorName }}</span>
                  <span class="shrink-0 text-xs text-[var(--c-text-muted)]">
                    {{ contributor.revisions }} revs · {{ formatDate(contributor.lastContributionAt) }}
                  </span>
                </li>
              </ul>
              <p v-else class="text-xs text-[var(--c-text-muted)]">No revisions yet.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>
