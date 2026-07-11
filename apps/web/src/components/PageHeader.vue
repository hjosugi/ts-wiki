<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { computed, ref, watch } from 'vue'
import { Api, type Page, type PageInsight, type PageShareView } from '@/lib/api'
import WikiBreadcrumbs from '@/components/WikiBreadcrumbs.vue'
import { useI18n } from '@/lib/i18n'
import StatusBadge from '@/components/StatusBadge.vue'
import { useAuth } from '@/stores/auth'
import { useDialogs } from '@/composables/useDialogs'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{
  page: Page
  canEdit: boolean
  homePath?: string
}>()
const auth = useAuth()
const dialogs = useDialogs()
const router = useRouter()

const copied = ref(false)
const share = ref<PageShareView | null>(null)
const shareBusy = ref(false)
const shareMessage = ref<string | null>(null)
const shareError = ref<string | null>(null)
const insightsOpen = ref(false)
const insightsLoading = ref(false)
const insightsError = ref<string | null>(null)
const insights = ref<PageInsight | null>(null)
const watching = ref(false)
const watchBusy = ref(false)
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
const printExportUrl = computed(() => `/api/export/page?path=${encodeURIComponent(props.page.path)}&format=print`)
const labels = computed(() => props.page.labels.filter((label) => !label.startsWith('kawaii-wiki-')))
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

async function loadWatch(): Promise<void> {
  if (!auth.isAuthed) return
  watching.value = (await Api.pageWatch(props.page.path).catch(() => ({ watching: false }))).watching
}

async function toggleWatch(): Promise<void> {
  watchBusy.value = true
  try {
    watching.value = (await Api.setPageWatch(props.page.path, !watching.value)).watching
  } finally {
    watchBusy.value = false
  }
}

async function duplicatePage(): Promise<void> {
  const suggested = `${props.page.path}-copy`
  const newPath = await dialogs.prompt({
    title: 'Duplicate page',
    message: 'Choose the path for the copied draft.',
    inputLabel: 'New path',
    defaultValue: suggested,
    required: true,
    confirmLabel: 'Duplicate',
  })
  if (!newPath?.trim()) return
  const copy = await Api.copyPage(props.page.path, newPath.trim())
  await router.push(`/_edit/${copy.path}`)
}

async function loadInsights(): Promise<void> {
  insightsLoading.value = true
  insightsError.value = null
  try {
    insights.value = await Api.pageInsights(props.page.path)
  } catch (e) {
    insightsError.value = friendlyError(e)
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
    shareError.value = friendlyError(e)
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
    shareError.value = friendlyError(e)
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
  void loadWatch()
}, { immediate: true })
</script>

<template>
  <header class="mb-5 min-w-0 border-b border-gray-200 pb-5 dark:border-gray-800">
    <div
      v-if="page.coverUrl"
      class="mb-5 h-48 overflow-hidden rounded-md bg-[var(--c-surface-muted)] bg-cover sm:h-64"
      :style="coverStyle"
      aria-hidden="true"
    ></div>
    <WikiBreadcrumbs :path="page.path" :home-path="homePath" :current-icon="page.icon" />

    <div class="mt-3 flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{{ t('viewingMode') }}</p>
        <h1 class="flex min-w-0 items-center gap-3 text-2xl font-bold tracking-tight text-gray-950 dark:text-gray-50 sm:text-3xl">
          <span v-if="page.icon" class="shrink-0 text-4xl leading-none" aria-hidden="true">{{ page.icon }}</span>
          <span class="min-w-0 break-words">{{ page.title }}</span>
        </h1>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-[var(--c-text-muted)]">
          <StatusBadge :status="page.status" />
          <span>{{ t('updated', { date: updated }) }}</span>
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

      <div class="w-full min-w-0 space-y-2 sm:w-auto">
        <div class="flex flex-wrap justify-start gap-2 sm:justify-end">
          <button v-if="auth.isAuthed" class="btn-ghost gap-1.5" type="button" :disabled="watchBusy" :aria-pressed="watching" @click="toggleWatch">
            <AppIcon name="eye" :size="16" />
            {{ watching ? t('watching') : t('watch') }}
          </button>
          <RouterLink v-if="canEdit" :to="'/_edit/' + page.path" class="btn-primary gap-1.5">
            <AppIcon name="edit" :size="16" />
            {{ t('editPage') }}
          </RouterLink>
          <details class="relative">
            <summary class="btn-ghost cursor-pointer list-none gap-1.5"><AppIcon name="more" :size="16" />{{ t('moreActions') }}</summary>
            <div class="absolute right-0 z-20 mt-2 grid w-[min(18rem,calc(100vw-2rem))] rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-1 shadow-xl">
              <button class="rounded px-3 py-2 text-left text-sm hover:bg-[var(--c-surface-muted)]" type="button" @click="copyPath">{{ copied ? t('copied') : t('copyPath') }}</button>
              <button class="rounded px-3 py-2 text-left text-sm hover:bg-[var(--c-surface-muted)]" type="button" :aria-expanded="insightsOpen" aria-controls="page-insights" @click="toggleInsights">{{ t('insights') }}</button>
              <button v-if="canEdit" class="rounded px-3 py-2 text-left text-sm hover:bg-[var(--c-surface-muted)]" type="button" :disabled="shareBusy" @click="share ? copyShareLink() : createShareLink()">{{ share ? t('copyShareLink') : t('share') }}</button>
              <button v-if="canEdit && share" class="rounded px-3 py-2 text-left text-sm hover:bg-[var(--c-surface-muted)]" type="button" :disabled="shareBusy" @click="revokeShareLink">{{ t('revokeShare') }}</button>
              <RouterLink v-if="canEdit" :to="{ name: 'new', query: { path: childPath } }" class="rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]">{{ t('newChild') }}</RouterLink>
              <button v-if="canEdit" class="rounded px-3 py-2 text-left text-sm hover:bg-[var(--c-surface-muted)]" type="button" @click="duplicatePage">{{ t('duplicate') }}</button>
              <RouterLink :to="'/_history/' + page.path" class="rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]">{{ t('history') }}</RouterLink>
              <a class="rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]" :href="markdownExportUrl">{{ t('downloadMarkdown') }}</a>
              <a class="rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]" :href="htmlExportUrl">{{ t('downloadHtml') }}</a>
              <a class="rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]" :href="printExportUrl" target="_blank" rel="noopener">{{ t('printPdf') }}</a>
            </div>
          </details>
        </div>
        <p v-if="shareError" class="text-right text-xs text-red-600">{{ shareError }}</p>
        <p v-else-if="shareMessage" class="text-right text-xs text-gray-500">{{ shareMessage }}</p>
        <div
          v-if="insightsOpen"
          id="page-insights"
          class="ml-auto w-full max-w-md rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm shadow-sm"
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
