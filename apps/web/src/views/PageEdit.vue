<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { Api, type AssetView, type Page } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import { usePresence } from '@/composables/usePresence'
import { assetFolderFromPagePath, attachmentsForPage } from '@/lib/assets'
import { useI18n } from '@/lib/i18n'
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

const isEdit = computed(() => route.name === 'edit')
const title = ref('')
const path = ref('')
const originalPath = ref('')
const originalUpdatedAt = ref<number | null>(null)
const content = ref('')
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
const editorMode = ref<'markdown' | 'visual'>('markdown')
const collabDisabledForSession = ref(false)
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

const dirty = computed(
  () =>
    title.value !== savedTitle.value ||
    path.value !== savedPath.value ||
    content.value !== savedContent.value ||
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
interface DraftSnapshot {
  title: string
  path: string
  content: string
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
  labelsText.value = labelTextFromJson(page.labels)
  status.value = page.status
  reviewAtDate.value = dateInputValue(page.reviewAt)
  locale.value = page.locale
  navOrderText.value = page.navOrder === null ? '' : String(page.navOrder)
  pinned.value = page.pinned
}

function markSaved(): void {
  savedTitle.value = title.value
  savedPath.value = path.value
  savedContent.value = content.value
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

function applyTemplate(key: string): void {
  const template = templateOptions.value.find((item) => item.key === key)
  if (!template) return
  title.value = template.metadata.title ?? template.label
  if (!path.value && template.metadata.path) path.value = template.metadata.path
  labelsText.value = template.metadata.labels?.join(', ') ?? ''
  status.value = template.metadata.status ?? 'draft'
  reviewAtDate.value = dateInputValue(template.metadata.reviewAt ?? null)
  locale.value = template.metadata.locale ?? defaultLocale.value
  content.value = template.content
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

// Announce "editing" presence so readers of this page see "… is editing".
usePresence(originalPath, 'editing')

onMounted(async () => {
  if (!auth.canEdit) {
    router.replace({ name: 'login' })
    return
  }
  defaultLocale.value = (await Api.publicSettings().catch(() => null))?.defaultLocale ?? 'und'
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
    path.value = (route.query.path as string) ?? ''
    title.value = ''
    content.value = builtInTemplates[0]?.content ?? ''
    labelsText.value = ''
    status.value = 'draft'
    reviewAtDate.value = ''
    locale.value = defaultLocale.value
    navOrderText.value = ''
    pinned.value = false
    originalUpdatedAt.value = null
    attachments.value = []
    attachmentsLoaded.value = false
    markSaved()
  }
})

watch(selectedTemplate, (key, previous) => {
  if (!isEdit.value && key !== previous) applyTemplate(key)
})

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
    const metadata = {
      labels: labels(),
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
    const message = (e as Error).message
    if (isEdit.value && /changed since you opened|reload the latest/i.test(message)) {
      conflictDraft.value = captureDraft()
      try {
        const latest = await Api.getPage(originalPath.value)
        applyPage(latest)
        markSaved()
        error.value = `${message} Latest version loaded; merge from your saved draft below, then save again.`
      } catch {
        error.value = message
      }
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
      <input v-model="title" class="input flex-1 min-w-50 text-lg font-semibold" :placeholder="t('pageTitle')" />
      <input v-model="path" class="input font-mono text-sm max-w-xs" :placeholder="t('pathPlaceholder')" />
      <select v-if="!isEdit" v-model="selectedTemplate" class="input max-w-56">
        <option v-for="template in templateOptions" :key="template.key" :value="template.key">
          {{ template.icon ? `${template.icon} ` : '' }}{{ template.label }}
        </option>
      </select>
      <RouterLink class="btn-ghost" to="/_templates">
        Templates
      </RouterLink>
      <button class="btn-ghost" type="button" :disabled="savingTemplate" @click="openSaveTemplate">
        Save as template
      </button>
      <select v-model="status" class="input max-w-40">
        <option value="draft">draft</option>
        <option value="in-review">in-review</option>
        <option value="verified">verified</option>
        <option value="outdated">outdated</option>
      </select>
      <input v-model="reviewAtDate" class="input max-w-42" type="date" :title="t('reviewDate')" />
      <input v-model="locale" class="input max-w-28" placeholder="locale" :title="t('locale')" />
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
      />
      <button class="btn-primary" :disabled="saving || !title || !path" @click="save">
        {{ saving ? t('saving') : t('save') }}
      </button>
      <button v-if="isEdit" class="btn-ghost" @click="archive">{{ t('archive') }}</button>
      <button v-if="isEdit" class="btn-danger" @click="remove">{{ t('delete') }}</button>
    </div>
    <section v-if="showTemplateSave" class="mb-4 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <form class="grid gap-2 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_auto_auto]" @submit.prevent="saveCurrentAsTemplate">
        <input v-model="templateIcon" class="input" maxlength="24" placeholder="Icon" />
        <input v-model="templateName" class="input" required placeholder="Template name" />
        <input v-model="templateDescription" class="input" placeholder="Description" />
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
      <span v-if="templatesLoading" class="text-[var(--c-text-muted)]">Loading templates...</span>
      <div class="inline-flex rounded-md border border-gray-200 p-0.5 dark:border-gray-800" aria-label="Editor mode">
        <button
          type="button"
          class="px-3 py-1 rounded text-sm font-medium transition-colors"
          :class="editorMode === 'markdown' ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'"
          @click="setEditorMode('markdown')"
        >
          {{ t('markdown') }}
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded text-sm font-medium transition-colors"
          :class="editorMode === 'visual' ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'"
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
      <div v-else class="text-gray-400">{{ t('loadingEditor') }}</div>
    </template>
    <MarkdownEditor v-else v-model="content" :asset-folder="assetFolder" />
  </div>
</template>
