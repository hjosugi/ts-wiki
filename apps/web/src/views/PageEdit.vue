<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { normalizePath } from '@ts-wiki/core'
import { Api, ApiClientError, type AssetView, type Page, type UserPreferenceMap } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import { usePresence } from '@/composables/usePresence'
import { useMarkdownFeatures } from '@/composables/useMarkdownFeatures'
import { assetFolderFromPagePath, attachmentsForPage } from '@/lib/assets'
import { useI18n } from '@/lib/i18n'
import { vMarkdownEnhance } from '@/lib/markdownEnhance'
import Skeleton from '@/components/Skeleton.vue'
import {
  builtInPageTemplates,
  pageTemplateToOption,
  templateMetadataFromPageDraft,
  type PageTemplateOption,
} from '@/lib/pageTemplates'

const MarkdownEditor = defineAsyncComponent(() => import('@/components/MarkdownEditor.vue'))
const CollabEditor = defineAsyncComponent(() => import('@/components/CollabEditor.vue'))
const VisualEditor = defineAsyncComponent(() => import('@/components/VisualEditor.vue'))
const PageAttachments = defineAsyncComponent(() => import('@/components/PageAttachments.vue'))

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const pagesStore = usePages()
const { t } = useI18n()
const { markdownFeatures, markdownRenderer } = useMarkdownFeatures()

const isEdit = computed(() => route.name === 'edit')
const title = ref('')
const path = ref('')
const originalPath = ref('')
const originalUpdatedAt = ref<number | null>(null)
const content = ref('')
const icon = ref('')
const coverUrl = ref('')
const coverPosition = ref('center')
const labelsText = ref('')
const status = ref<'draft' | 'in-review' | 'verified' | 'outdated'>('draft')
const reviewAtDate = ref('')
const locale = ref('und')
const defaultLocale = ref('und')
const navOrderText = ref('')
const pinned = ref(false)
const savedTitle = ref('')
const savedPath = ref('')
const savedContent = ref('')
const savedIcon = ref('')
const savedCoverUrl = ref('')
const savedCoverPosition = ref('center')
const savedLabelsText = ref('')
const savedStatus = ref(status.value)
const savedReviewAtDate = ref('')
const savedLocale = ref('und')
const savedNavOrderText = ref('')
const savedPinned = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const conflictDraft = ref<DraftSnapshot | null>(null)
const selectedTemplate = ref('builtin:blank')
let skipNextTemplateWatch = false
const editorMode = ref<'markdown' | 'visual'>('markdown')
const editorModeLoaded = ref(false)
const collabDisabledForSession = ref(false)
const pathManuallyEdited = ref(false)
const advancedPathOpen = ref(false)
const createParentPath = ref('')
const attachments = ref<AssetView[]>([])
const attachmentsLoading = ref(false)
const attachmentsLoaded = ref(false)
const builtInTemplates = builtInPageTemplates()
const customTemplates = ref<PageTemplateOption[]>([])
const templateOptions = computed(() => [...builtInTemplates, ...customTemplates.value])
const templatesLoading = ref(false)
const showTemplateSave = ref(false)
const templateName = ref('')
const templateDescription = ref('')
const templateIcon = ref('')
const savingTemplate = ref(false)
const coverUploading = ref(false)
const iconOptions = ['⭐', '📘', '📝', '📣', '🎤', '🎨', '🗓️', '📌', '✅', '🔥', '🌸', '🧭', '💡', '⚙️', '🔒']
const coverPositions = ['center', 'top', 'bottom', 'left', 'right']

const dirty = computed(
  () =>
    title.value !== savedTitle.value ||
    path.value !== savedPath.value ||
    content.value !== savedContent.value ||
    icon.value !== savedIcon.value ||
    coverUrl.value !== savedCoverUrl.value ||
    coverPosition.value !== savedCoverPosition.value ||
    labelsText.value !== savedLabelsText.value ||
    status.value !== savedStatus.value ||
    reviewAtDate.value !== savedReviewAtDate.value ||
    locale.value !== savedLocale.value ||
    navOrderText.value !== savedNavOrderText.value ||
    pinned.value !== savedPinned.value,
)
const saveStatus = computed(() => {
  if (saving.value) return t('saving')
  if (error.value) return t('saveFailed')
  if (dirty.value) return t('unsavedChanges')
  return t('saved')
})
const useCollaborativeMarkdown = computed(
  () => isEdit.value && editorMode.value === 'markdown' && originalPath.value && !collabDisabledForSession.value,
)
const assetFolder = computed(() => assetFolderFromPagePath(path.value || originalPath.value))
const coverPreviewStyle = computed(() =>
  coverUrl.value
    ? {
        backgroundImage: `url(${JSON.stringify(coverUrl.value)})`,
        backgroundSize: 'cover',
        backgroundPosition: coverPosition.value,
      }
    : {},
)
const existingPaths = computed(() => new Set(pagesStore.list.map((page) => page.path)))
const createPathPreview = computed(() => path.value || nextAvailablePath(suggestedCreatePath()))
interface DraftSnapshot {
  title: string
  path: string
  content: string
  icon: string
  coverUrl: string
  coverPosition: string
  labelsText: string
  status: 'draft' | 'in-review' | 'verified' | 'outdated'
  reviewAtDate: string
  locale: string
  navOrderText: string
  pinned: boolean
}

function captureDraft(): DraftSnapshot {
  return {
    title: title.value,
    path: path.value,
    content: content.value,
    icon: icon.value,
    coverUrl: coverUrl.value,
    coverPosition: coverPosition.value,
    labelsText: labelsText.value,
    status: status.value,
    reviewAtDate: reviewAtDate.value,
    locale: locale.value,
    navOrderText: navOrderText.value,
    pinned: pinned.value,
  }
}

function applyDraft(draft: DraftSnapshot): void {
  title.value = draft.title
  path.value = draft.path
  content.value = draft.content
  icon.value = draft.icon
  coverUrl.value = draft.coverUrl
  coverPosition.value = draft.coverPosition
  labelsText.value = draft.labelsText
  status.value = draft.status
  reviewAtDate.value = draft.reviewAtDate
  locale.value = draft.locale
  navOrderText.value = draft.navOrderText
  pinned.value = draft.pinned
}

function applyPage(page: Page): void {
  title.value = page.title
  path.value = page.path
  originalPath.value = page.path
  originalUpdatedAt.value = page.updatedAt
  content.value = page.content
  icon.value = page.icon
  coverUrl.value = page.coverUrl
  coverPosition.value = page.coverPosition || 'center'
  labelsText.value = labelTextFromJson(page.labels)
  status.value = page.status
  reviewAtDate.value = dateInputValue(page.reviewAt)
  locale.value = page.locale
  navOrderText.value = page.navOrder === null ? '' : String(page.navOrder)
  pinned.value = page.pinned
  pathManuallyEdited.value = true
}

function markSaved(): void {
  savedTitle.value = title.value
  savedPath.value = path.value
  savedContent.value = content.value
  savedIcon.value = icon.value
  savedCoverUrl.value = coverUrl.value
  savedCoverPosition.value = coverPosition.value
  savedLabelsText.value = labelsText.value
  savedStatus.value = status.value
  savedReviewAtDate.value = reviewAtDate.value
  savedLocale.value = locale.value
  savedNavOrderText.value = navOrderText.value
  savedPinned.value = pinned.value
}

const labels = (): string[] =>
  labelsText.value
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)

const reviewAt = (): number | null =>
  reviewAtDate.value ? new Date(`${reviewAtDate.value}T00:00:00`).getTime() : null

const navOrder = (): number | null => {
  const trimmed = navOrderText.value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

const labelTextFromJson = (value: string): string => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((label): label is string => typeof label === 'string').join(', ')
      : ''
  } catch {
    return ''
  }
}

const dateInputValue = (value: number | null): string =>
  value ? new Date(value).toISOString().slice(0, 10) : ''

const titlePathSegment = (): string => normalizePath(title.value || 'new-page') || 'new-page'

function nextAvailablePath(base: string): string {
  const normalized = normalizePath(base) || 'new-page'
  if (!existingPaths.value.has(normalized)) return normalized
  let index = 2
  while (existingPaths.value.has(`${normalized}-${index}`)) index += 1
  return `${normalized}-${index}`
}

function suggestedCreatePath(): string {
  const segment = titlePathSegment()
  return createParentPath.value ? `${createParentPath.value}/${segment}` : segment
}

function applyAutoPath(): void {
  if (isEdit.value || pathManuallyEdited.value) return
  path.value = nextAvailablePath(suggestedCreatePath())
}

function setManualPath(value: string): void {
  pathManuallyEdited.value = true
  path.value = value
}

function seedCreatePathFromRoute(): void {
  const seed = normalizePath(String(route.query.path ?? ''))
  createParentPath.value = ''
  pathManuallyEdited.value = false
  advancedPathOpen.value = false
  if (!seed) {
    applyAutoPath()
    return
  }
  if (seed.endsWith('/new-page')) {
    createParentPath.value = seed.replace(/\/new-page$/, '')
    applyAutoPath()
    return
  }
  path.value = seed
  pathManuallyEdited.value = true
  advancedPathOpen.value = true
}

function queryString(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

function templatePreviewHtml(template: PageTemplateOption): string {
  return markdownRenderer.value.renderMarkdown(template.content).html
}

function applyTemplate(key: string): void {
  const template = templateOptions.value.find((item) => item.key === key)
  if (!template) return
  title.value = template.metadata.title ?? template.label
  if (template.metadata.path && !isEdit.value) {
    path.value = nextAvailablePath(template.metadata.path)
    pathManuallyEdited.value = true
  }
  labelsText.value = template.metadata.labels?.join(', ') ?? ''
  status.value = template.metadata.status ?? 'draft'
  reviewAtDate.value = dateInputValue(template.metadata.reviewAt ?? null)
  locale.value = template.metadata.locale ?? defaultLocale.value
  content.value = template.content
}

function selectTemplate(key: string): void {
  if (selectedTemplate.value !== key) {
    skipNextTemplateWatch = true
    selectedTemplate.value = key
  }
  applyTemplate(key)
}

function applyCreateQueryOverrides(): void {
  const requestedTemplate = queryString(route.query.template).trim()
  if (requestedTemplate && templateOptions.value.some((item) => item.key === requestedTemplate)) {
    selectTemplate(requestedTemplate)
  }
  const requestedTitle = queryString(route.query.title).trim().slice(0, 160)
  if (requestedTitle) {
    title.value = requestedTitle
    content.value = content.value.replace(/^# .*(\r?\n|$)/, `# ${requestedTitle}\n`)
  }
}

async function loadTemplates(): Promise<void> {
  templatesLoading.value = true
  try {
    customTemplates.value = (await Api.templates()).map(pageTemplateToOption)
  } catch {
    customTemplates.value = []
  } finally {
    templatesLoading.value = false
  }
}

function openSaveTemplate(): void {
  templateName.value = title.value || 'Page template'
  templateDescription.value = ''
  templateIcon.value = ''
  showTemplateSave.value = true
}

async function saveCurrentAsTemplate(): Promise<void> {
  if (!templateName.value.trim()) return
  savingTemplate.value = true
  error.value = null
  try {
    const template = await Api.createTemplate({
      name: templateName.value,
      description: templateDescription.value,
      icon: templateIcon.value,
      content: content.value,
      metadata: templateMetadataFromPageDraft({
        title: title.value,
        path: path.value,
        labels: labels(),
        status: status.value,
        locale: locale.value,
        reviewAt: reviewAt(),
      }),
    })
    customTemplates.value = [
      pageTemplateToOption(template),
      ...customTemplates.value.filter((item) => item.key !== `custom:${template.id}`),
    ]
    selectedTemplate.value = `custom:${template.id}`
    showTemplateSave.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    savingTemplate.value = false
  }
}

function setEditorMode(mode: 'markdown' | 'visual'): void {
  if (mode === 'visual' && isEdit.value) collabDisabledForSession.value = true
  editorMode.value = mode
  if (editorModeLoaded.value && auth.isAuthed) {
    void Api.updatePreferences({ 'editor:mode': mode } as UserPreferenceMap).catch(() => {})
  }
}

async function loadAttachments(pagePath: string): Promise<void> {
  attachmentsLoading.value = true
  attachmentsLoaded.value = false
  try {
    attachments.value = attachmentsForPage(await Api.assetUsage(pagePath), pagePath)
  } catch {
    attachments.value = []
  } finally {
    attachmentsLoading.value = false
    attachmentsLoaded.value = true
  }
}

async function uploadCover(files: FileList | null): Promise<void> {
  if (!files?.[0]) return
  coverUploading.value = true
  error.value = null
  try {
    const asset = await Api.uploadAsset(files[0], assetFolder.value)
    coverUrl.value = asset.url
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    coverUploading.value = false
  }
}

// Announce "editing" presence so readers of this page see "… is editing".
usePresence(originalPath, 'editing')

onMounted(async () => {
  if (!auth.canEdit) {
    router.replace({ name: 'login' })
    return
  }
  await pagesStore.refresh()
  const publicSettings = await Api.publicSettings().catch(() => null)
  defaultLocale.value = publicSettings?.defaultLocale ?? 'und'
  const preferences = auth.isAuthed ? await Api.preferences().catch(() => ({} as UserPreferenceMap)) : {}
  const preferredMode = preferences['editor:mode'] === 'markdown' || preferences['editor:mode'] === 'visual'
    ? preferences['editor:mode']
    : publicSettings?.defaultEditorMode ?? 'visual'
  editorMode.value = preferredMode
  if (preferredMode === 'visual' && isEdit.value) collabDisabledForSession.value = true
  editorModeLoaded.value = true
  void loadTemplates()
  if (isEdit.value) {
    const target = paramToPath(route.params.path)
    try {
      const page = await Api.getPage(target)
      applyPage(page)
      markSaved()
      void loadAttachments(page.path)
    } catch (e) {
      error.value = (e as Error).message
    }
  } else {
    title.value = ''
    content.value = builtInTemplates[0]?.content ?? ''
    labelsText.value = ''
    icon.value = ''
    coverUrl.value = ''
    coverPosition.value = 'center'
    status.value = 'draft'
    reviewAtDate.value = ''
    locale.value = defaultLocale.value
    navOrderText.value = ''
    pinned.value = false
    originalUpdatedAt.value = null
    attachments.value = []
    attachmentsLoaded.value = false
    seedCreatePathFromRoute()
    applyCreateQueryOverrides()
    markSaved()
  }
})

watch(selectedTemplate, (key, previous) => {
  if (skipNextTemplateWatch) {
    skipNextTemplateWatch = false
    return
  }
  if (!isEdit.value && key !== previous) applyTemplate(key)
})

watch(title, applyAutoPath)

function beforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value || saving.value) return
  event.preventDefault()
  event.returnValue = ''
}

window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => {
  if (!dirty.value || saving.value) return true
  return confirm(t('discardUnsavedChanges'))
})

async function save(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    if (!isEdit.value && !path.value) path.value = createPathPreview.value
    const metadata = {
      labels: labels(),
      icon: icon.value,
      coverUrl: coverUrl.value,
      coverPosition: coverPosition.value,
      status: status.value,
      reviewAt: reviewAt(),
      locale: locale.value,
      navOrder: navOrder(),
      pinned: pinned.value,
    }
    if (isEdit.value) {
      if (path.value !== originalPath.value) {
        const inbound = await Api.backlinks(originalPath.value).catch(() => [])
        if (inbound.length > 0 && !confirm(`${inbound.length} inbound link${inbound.length === 1 ? '' : 's'} point to /${originalPath.value}. Move anyway?`)) {
          path.value = originalPath.value
          return
        }
      }
      const updated = await Api.updatePage(originalPath.value, {
        title: title.value,
        content: content.value,
        ...metadata,
        expectedUpdatedAt: originalUpdatedAt.value,
      })
      originalUpdatedAt.value = updated.updatedAt
      if (path.value !== originalPath.value) {
        const moved = await Api.movePage(originalPath.value, path.value)
        path.value = moved.path
        originalPath.value = moved.path
        originalUpdatedAt.value = moved.updatedAt
      } else {
        path.value = updated.path
        originalPath.value = updated.path
      }
    } else {
      const created = await Api.createPage({ path: path.value, title: title.value, content: content.value, ...metadata })
      originalUpdatedAt.value = created.updatedAt
    }
    conflictDraft.value = null
    await pagesStore.refresh()
    markSaved()
    router.push('/' + path.value)
  } catch (e) {
    const apiError = e instanceof ApiClientError ? e : null
    const message = (e as Error).message
    const rawMessage = apiError?.rawMessage ?? message
    if (isEdit.value && (apiError?.kind === 'conflict' || /changed since you opened|reload the latest/i.test(rawMessage))) {
      conflictDraft.value = captureDraft()
      try {
        const latest = await Api.getPage(originalPath.value)
        applyPage(latest)
        markSaved()
        error.value = `${message} Latest version loaded; merge from your saved draft below, then save again.`
      } catch {
        error.value = message
      }
    } else if (!isEdit.value && (apiError?.kind === 'conflict' || /already exists|duplicate/i.test(rawMessage))) {
      const suggested = nextAvailablePath(path.value || suggestedCreatePath())
      path.value = suggested
      pathManuallyEdited.value = true
      advancedPathOpen.value = true
      error.value = `${message} Suggested path: /${suggested}`
    } else {
      error.value = message
    }
  } finally {
    saving.value = false
  }
}

function restoreConflictDraft(): void {
  if (!conflictDraft.value) return
  applyDraft(conflictDraft.value)
}

function discardConflictDraft(): void {
  conflictDraft.value = null
}

async function remove(): Promise<void> {
  if (!confirm(`Move "${title.value}" to trash? It can be restored by an admin/editor.`)) return
  try {
    await Api.deletePage(path.value)
    await pagesStore.refresh()
    router.push('/')
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function archive(): Promise<void> {
  if (!confirm(`Archive "${title.value}"? It will be hidden from search and navigation.`)) return
  try {
    await Api.archivePage(path.value)
    await pagesStore.refresh()
    router.push('/')
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input v-model="title" class="input flex-1 min-w-50 text-lg font-semibold" :placeholder="t('pageTitle')" :aria-label="t('pageTitle')" />
      <RouterLink class="btn-ghost" to="/_templates">
        Templates
      </RouterLink>
      <button class="btn-ghost" type="button" :disabled="savingTemplate" @click="openSaveTemplate">
        Save as template
      </button>
      <select v-model="status" class="input max-w-40" aria-label="Page status">
        <option value="draft">draft</option>
        <option value="in-review">in-review</option>
        <option value="verified">verified</option>
        <option value="outdated">outdated</option>
      </select>
      <input v-model="reviewAtDate" class="input max-w-42" type="date" :title="t('reviewDate')" :aria-label="t('reviewDate')" />
      <input v-model="locale" class="input max-w-28" placeholder="locale" :title="t('locale')" :aria-label="t('locale')" />
      <label class="inline-flex items-center gap-2 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-2 text-sm">
        <input v-model="pinned" type="checkbox" />
        <span>Pinned</span>
      </label>
      <input
        v-model="navOrderText"
        class="input max-w-30"
        inputmode="numeric"
        placeholder="Nav order"
        title="Shared sidebar order"
        aria-label="Shared sidebar order"
      />
      <button class="btn-primary" :disabled="saving || !title || !path" @click="save">
        {{ saving ? t('saving') : t('save') }}
      </button>
      <button v-if="isEdit" class="btn-ghost" @click="archive">{{ t('archive') }}</button>
      <button v-if="isEdit" class="btn-danger" @click="remove">{{ t('delete') }}</button>
    </div>

    <section class="mb-4 grid gap-3 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3 lg:grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)]">
      <div class="space-y-2">
        <label class="block text-sm font-medium" for="page-icon">Page icon</label>
        <div class="flex gap-2">
          <input id="page-icon" v-model="icon" class="input max-w-24 text-center text-xl" maxlength="16" placeholder="⭐" aria-label="Page icon" />
          <button class="btn-ghost" type="button" @click="icon = ''">Clear</button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="option in iconOptions"
            :key="option"
            class="h-8 w-8 rounded-md border border-[var(--c-border)] bg-[var(--c-bg)] text-base hover:border-[var(--c-accent)]"
            type="button"
            :aria-label="`Use ${option} as page icon`"
            @click="icon = option"
          >
            {{ option }}
          </button>
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
        <div class="space-y-2">
          <label class="block text-sm font-medium" for="cover-url">Cover image</label>
          <input id="cover-url" v-model="coverUrl" class="input" placeholder="/assets/cover.jpg" aria-label="Cover image URL" />
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <select v-model="coverPosition" class="input max-w-36" aria-label="Cover position">
              <option v-for="position in coverPositions" :key="position" :value="position">{{ position }}</option>
            </select>
            <input class="text-sm" type="file" accept="image/*" aria-label="Upload cover image" @change="uploadCover(($event.target as HTMLInputElement).files)" />
            <span v-if="coverUploading" class="text-xs text-[var(--c-text-muted)]">Uploading...</span>
            <button v-if="coverUrl" class="btn-ghost py-1 text-xs" type="button" @click="coverUrl = ''">Remove cover</button>
          </div>
        </div>
        <div
          class="min-h-28 overflow-hidden rounded-md border border-[var(--c-border)] bg-[var(--c-surface-muted)]"
          :style="coverPreviewStyle"
          aria-hidden="true"
        >
          <div v-if="!coverUrl" class="grid h-full min-h-28 place-items-center text-xs text-[var(--c-text-muted)]">No cover</div>
        </div>
      </div>
    </section>

    <section v-if="!isEdit" class="mb-4 space-y-3">
      <div class="rounded-md border border-[var(--c-border)] bg-[var(--c-surface-muted)] px-3 py-2 text-sm">
        <span class="text-[var(--c-text-muted)]">Page path:</span>
        <span class="font-mono">/{{ createPathPreview }}</span>
      </div>
      <details
        class="rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3"
        :open="advancedPathOpen"
        @toggle="advancedPathOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="cursor-pointer text-sm font-medium">Advanced path</summary>
        <div class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            class="input font-mono text-sm"
            :value="path"
            :placeholder="t('pathPlaceholder')"
            :aria-label="t('pathPlaceholder')"
            @input="setManualPath(($event.target as HTMLInputElement).value)"
          />
          <button
            class="btn-ghost"
            type="button"
            @click="pathManuallyEdited = false; applyAutoPath(); advancedPathOpen = false"
          >
            Auto
          </button>
        </div>
      </details>

      <section class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">Choose a template</h2>
          <Skeleton v-if="templatesLoading" class="w-40" label="Loading templates" :lines="1" />
        </div>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="template in templateOptions"
            :key="template.key"
            class="min-h-56 rounded-md border p-3 text-left transition-colors"
            :class="selectedTemplate === template.key ? 'border-[var(--c-accent)] bg-[var(--c-surface-muted)]' : 'border-[var(--c-border)] bg-[var(--c-surface)] hover:bg-[var(--c-surface-muted)]'"
            type="button"
            @click="selectTemplate(template.key)"
          >
            <span class="mb-2 flex items-start justify-between gap-3">
              <span>
                <span class="block text-sm font-semibold">{{ template.icon ? `${template.icon} ` : '' }}{{ template.label }}</span>
                <span class="block text-xs text-[var(--c-text-muted)]">{{ template.description || (template.builtIn ? 'Built-in starter' : 'Custom template') }}</span>
              </span>
              <span v-if="selectedTemplate === template.key" class="text-xs font-semibold text-[var(--c-accent)]">Selected</span>
            </span>
            <span
              class="prose dark:prose-invert block h-36 max-w-none overflow-hidden rounded border border-[var(--c-border)] bg-[var(--c-bg)] p-3 text-xs"
              v-markdown-enhance="markdownFeatures"
              v-html="templatePreviewHtml(template)"
            ></span>
          </button>
        </div>
      </section>
    </section>

    <details v-else class="mb-3 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3" open>
      <summary class="cursor-pointer text-sm font-medium">Path</summary>
      <input v-model="path" class="input mt-3 font-mono text-sm max-w-xs" :placeholder="t('pathPlaceholder')" :aria-label="t('pathPlaceholder')" />
    </details>
    <section v-if="showTemplateSave" class="mb-4 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <form class="grid gap-2 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto]" @submit.prevent="saveCurrentAsTemplate">
        <input v-model="templateIcon" class="input" maxlength="24" placeholder="Icon" aria-label="Template icon" />
        <input v-model="templateName" class="input" required placeholder="Template name" aria-label="Template name" />
        <input v-model="templateDescription" class="input" placeholder="Description" aria-label="Template description" />
        <button class="btn-primary" type="submit" :disabled="savingTemplate || !templateName">
          {{ savingTemplate ? 'Saving...' : 'Save template' }}
        </button>
        <button class="btn-ghost" type="button" @click="showTemplateSave = false">Cancel</button>
      </form>
    </section>
    <input
      v-model="labelsText"
      class="input mb-3"
      placeholder="labels, comma separated"
      aria-label="Labels"
    />
    <div class="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <span
        class="font-medium"
        :class="error ? 'text-red-600' : dirty ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'"
      >
        {{ saveStatus }}
      </span>
      <RouterLink v-if="isEdit && originalPath" class="link-quiet" :to="'/_history/' + originalPath">
        {{ t('history') }}
      </RouterLink>
      <Skeleton v-if="templatesLoading" class="w-40" label="Loading templates" :lines="1" />
      <div class="inline-flex rounded-md border border-gray-200 p-0.5 dark:border-gray-800" aria-label="Editor mode">
        <button
          type="button"
          class="px-3 py-1 rounded text-sm font-medium transition-colors"
          :class="editorMode === 'markdown' ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'"
          @click="setEditorMode('markdown')"
        >
          {{ t('markdown') }}
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded text-sm font-medium transition-colors"
          :class="editorMode === 'visual' ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'"
          @click="setEditorMode('visual')"
        >
          {{ t('visual') }}
        </button>
      </div>
    </div>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <section v-if="conflictDraft" class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-amber-900 dark:text-amber-100">{{ t('unsavedDraftKept') }}</h2>
        <div class="flex flex-wrap gap-2">
          <button class="btn-ghost" type="button" @click="restoreConflictDraft">{{ t('restoreDraft') }}</button>
          <button class="btn-ghost" type="button" @click="discardConflictDraft">{{ t('keepLatest') }}</button>
        </div>
      </div>
      <textarea
        class="input mt-3 min-h-32 font-mono text-xs"
        :value="conflictDraft.content"
        aria-label="Conflict draft content"
        readonly
      ></textarea>
    </section>
    <PageAttachments
      v-if="isEdit && (attachmentsLoading || attachmentsLoaded)"
      :assets="attachments"
      :loading="attachmentsLoading"
      show-empty
    />
    <VisualEditor v-if="editorMode === 'visual'" v-model="content" :asset-folder="assetFolder" />
    <template v-else-if="isEdit">
      <CollabEditor v-if="useCollaborativeMarkdown" :room="originalPath" :asset-folder="assetFolder" @update:modelValue="content = $event" />
      <MarkdownEditor v-else-if="originalPath" v-model="content" :asset-folder="assetFolder" />
      <Skeleton v-else :label="t('loadingEditor')" title :lines="5" />
    </template>
    <MarkdownEditor v-else v-model="content" :asset-folder="assetFolder" />
  </div>
</template>
