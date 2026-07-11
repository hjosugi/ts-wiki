<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref, computed, defineAsyncComponent, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { normalizePath } from '@kawaii-wiki/core'
import { Api, ApiClientError, type AssetView, type Page, type UserPreferenceMap } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import { usePresence } from '@/composables/usePresence'
import { useMarkdownFeatures } from '@/composables/useMarkdownFeatures'
import { assetFolderFromPagePath, attachmentsForPage } from '@/lib/assets'
import { useI18n } from '@/lib/i18n'
import { useDialogs } from '@/composables/useDialogs'
import { vMarkdownEnhance } from '@/lib/markdownEnhance'
import { unsupportedVisualMarkdownFeatures } from '@/lib/visualMarkdownCapabilities'
import Skeleton from '@/components/Skeleton.vue'
import FormField from '@/components/FormField.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import PageMetaBar from '@/components/PageMetaBar.vue'
import { usePageEditor } from '@/composables/usePageEditor'
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
const dialogs = useDialogs()
const { markdownFeatures, markdownRenderer } = useMarkdownFeatures()

const isEdit = computed(() => route.name === 'edit')
const {
  title,
  path,
  originalPath,
  originalUpdatedAt,
  content,
  icon,
  coverUrl,
  coverPosition,
  labelsText,
  status,
  reviewAtDate,
  publishAtDateTime,
  locale,
  navOrderText,
  pinned,
  conflictDraft,
  dirty,
  captureDraft,
  applyDraft,
  applyPage: applyPageState,
  markSaved,
  labels,
  reviewAt,
  publishAt,
  navOrder,
  dateInputValue,
} = usePageEditor()
const defaultLocale = ref('und')
const saving = ref(false)
const error = ref<string | null>(null)
const selectedTemplate = ref('builtin:blank')
let skipNextTemplateWatch = false
const editorMode = ref<'markdown' | 'visual'>('markdown')
const editorModeLoaded = ref(false)
const editorModeOptions = computed(() => [
  { value: 'markdown', label: t('markdown') },
  { value: 'visual', label: t('visual') },
])
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
const existingPaths = computed(() => new Set(pagesStore.list.map((page) => page.path)))
const createPathPreview = computed(() => path.value || nextAvailablePath(suggestedCreatePath()))
const titlePathSegment = (): string => normalizePath(title.value || 'new-page') || 'new-page'

function applyPage(page: Page): void {
  applyPageState(page)
  pathManuallyEdited.value = true
}

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
  publishAtDateTime.value = ''
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
    error.value = friendlyError(e)
  } finally {
    savingTemplate.value = false
  }
}

async function setEditorMode(mode: 'markdown' | 'visual'): Promise<void> {
  if (mode === editorMode.value) return
  if (mode === 'visual') {
    const unsupported = unsupportedVisualMarkdownFeatures(content.value)
    if (unsupported.length && !await dialogs.confirm({
      title: t('switchVisualEditorTitle'),
      message: t('switchVisualEditorMessage', { features: unsupported.join(', ') }),
      confirmLabel: t('switchEditor'),
    })) return
  }
  if (mode === 'visual' && isEdit.value) collabDisabledForSession.value = true
  editorMode.value = mode
  if (editorModeLoaded.value && auth.isAuthed) {
    void Api.updatePreferences({ 'editor:mode': mode } as UserPreferenceMap).catch(() => {})
  }
}

const onEditorModeInput = (mode: string): void => {
  if (mode === 'markdown' || mode === 'visual') void setEditorMode(mode)
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
    error.value = friendlyError(e)
  } finally {
    coverUploading.value = false
  }
}

// Announce "editing" presence so readers of this page see "… is editing".
usePresence(originalPath, 'editing')

onMounted(async () => {
  if (!auth.canEdit) {
    router.replace({ name: 'login', query: { redirect: route.fullPath } })
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
      error.value = friendlyError(e)
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
    publishAtDateTime.value = ''
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
onBeforeRouteLeave(async () => {
  if (!dirty.value || saving.value) return true
  return dialogs.confirm({ message: t('discardUnsavedChanges'), danger: true })
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
      publishAt: publishAt(),
      locale: locale.value,
      navOrder: navOrder(),
      pinned: pinned.value,
    }
    if (isEdit.value) {
      if (path.value !== originalPath.value) {
        const inbound = await Api.backlinks(originalPath.value).catch(() => [])
        if (inbound.length > 0 && !await dialogs.confirm({
          title: t('movePage'),
          message: t(inbound.length === 1 ? 'inboundLinkMoveConfirm' : 'inboundLinksMoveConfirm', { count: inbound.length, path: originalPath.value }),
        })) {
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
    const message = friendlyError(e)
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
  const targetPath = originalPath.value
  if (!await dialogs.confirm({ message: t('deletePageConfirm', { title: title.value, path: targetPath }), danger: true })) return
  try {
    await Api.deletePage(targetPath)
    await pagesStore.refresh()
    router.push('/')
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function archive(): Promise<void> {
  const targetPath = originalPath.value
  if (!await dialogs.confirm({ message: t('archivePageConfirm', { title: title.value, path: targetPath }) })) return
  try {
    await Api.archivePage(targetPath)
    await pagesStore.refresh()
    router.push('/')
  } catch (e) {
    error.value = friendlyError(e)
  }
}
</script>

<template>
  <div class="min-w-0">
    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--c-accent)]">{{ isEdit ? t('editingMode') : t('creatingMode') }}</p>
    <PageMetaBar
      v-model:title="title"
      v-model:status="status"
      v-model:review-at-date="reviewAtDate"
      v-model:publish-at-date-time="publishAtDateTime"
      v-model:locale="locale"
      v-model:pinned="pinned"
      v-model:nav-order-text="navOrderText"
      v-model:icon="icon"
      v-model:cover-url="coverUrl"
      v-model:cover-position="coverPosition"
      :is-edit="isEdit"
      :saving="saving"
      :saving-template="savingTemplate"
      :cover-uploading="coverUploading"
      :can-save="Boolean(title && path)"
      @save="save"
      @archive="archive"
      @remove="remove"
      @save-template="openSaveTemplate"
      @upload-cover="uploadCover"
    />

    <section v-if="!isEdit" class="mb-4 space-y-3">
      <div class="rounded-md border border-[var(--c-border)] bg-[var(--c-surface-muted)] px-3 py-2 text-sm">
        <span class="text-[var(--c-text-muted)]">{{ t('pagePathLabel') }}</span>
        <span class="font-mono">/{{ createPathPreview }}</span>
      </div>
      <details
        class="rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3"
        :open="advancedPathOpen"
        @toggle="advancedPathOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="cursor-pointer text-sm font-medium">{{ t('advancedPath') }}</summary>
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
            {{ t('auto') }}
          </button>
        </div>
      </details>

      <section class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">{{ t('chooseTemplate') }}</h2>
          <Skeleton v-if="templatesLoading" class="w-40" :label="t('loadingTemplates')" :lines="1" />
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
                <span class="block text-xs text-[var(--c-text-muted)]">{{ template.description || (template.builtIn ? t('builtInStarter') : t('customTemplate')) }}</span>
              </span>
              <span v-if="selectedTemplate === template.key" class="text-xs font-semibold text-[var(--c-accent)]">{{ t('selected') }}</span>
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
      <summary class="cursor-pointer text-sm font-medium">{{ t('path') }}</summary>
      <input v-model="path" class="input mt-3 font-mono text-sm max-w-xs" :placeholder="t('pathPlaceholder')" :aria-label="t('pathPlaceholder')" />
    </details>
    <section v-if="showTemplateSave" class="mb-4 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <form class="grid gap-2 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto]" @submit.prevent="saveCurrentAsTemplate">
        <input v-model="templateIcon" class="input" maxlength="24" :placeholder="t('templateIcon')" :aria-label="t('templateIcon')" />
        <input v-model="templateName" class="input" required :placeholder="t('templateName')" :aria-label="t('templateName')" />
        <input v-model="templateDescription" class="input" :placeholder="t('description')" :aria-label="t('templateDescription')" />
        <button class="btn-primary" type="submit" :disabled="savingTemplate || !templateName">
          {{ savingTemplate ? t('saving') : t('saveTemplate') }}
        </button>
        <button class="btn-ghost" type="button" @click="showTemplateSave = false">{{ t('cancel') }}</button>
      </form>
    </section>
    <FormField class="mb-3" :label="t('labels')" for-id="page-labels" :hint="t('labelsHint')">
      <input id="page-labels" v-model="labelsText" class="input" :placeholder="t('labelsPlaceholder')" />
    </FormField>
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
      <Skeleton v-if="templatesLoading" class="w-40" :label="t('loadingTemplates')" :lines="1" />
      <SegmentedControl :model-value="editorMode" :options="editorModeOptions" :label="t('editorMode')" @update:model-value="onEditorModeInput" />
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
