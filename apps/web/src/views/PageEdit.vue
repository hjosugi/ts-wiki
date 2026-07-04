<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { Api, type Page } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import { usePresence } from '@/composables/usePresence'
import { useI18n } from '@/lib/i18n'

const MarkdownEditor = defineAsyncComponent(() => import('@/components/MarkdownEditor.vue'))
const CollabEditor = defineAsyncComponent(() => import('@/components/CollabEditor.vue'))
const VisualEditor = defineAsyncComponent(() => import('@/components/VisualEditor.vue'))

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
const savedTitle = ref('')
const savedPath = ref('')
const savedContent = ref('')
const savedLabelsText = ref('')
const savedStatus = ref(status.value)
const savedReviewAtDate = ref('')
const savedLocale = ref('und')
const saving = ref(false)
const error = ref<string | null>(null)
const conflictDraft = ref<DraftSnapshot | null>(null)
const selectedTemplate = ref('blank')
const editorMode = ref<'markdown' | 'visual'>('markdown')
const collabDisabledForSession = ref(false)

const templates = [
  {
    key: 'blank',
    label: 'Blank',
    title: '',
    path: '',
    content: '# New page\n\nStart writing in **Markdown**...\n',
  },
  {
    key: 'decision',
    label: 'Decision',
    title: 'Decision',
    path: 'decisions/new-decision',
    content: '# Decision\n\n## Context\n\n## Options\n\n## Decision\n\n## Consequences\n',
  },
  {
    key: 'how-to',
    label: 'How-to',
    title: 'How-to',
    path: 'guides/new-guide',
    content: '# How-to\n\n## Goal\n\n## Steps\n\n1. \n\n## Checks\n',
  },
  {
    key: 'meeting',
    label: 'Meeting notes',
    title: 'Meeting notes',
    path: 'meetings/new-meeting',
    content: '# Meeting notes\n\n```event\ntitle: Meeting\nstart: 2026-07-04 10:00\ntimezone: Asia/Tokyo\ndescription:\n```\n\n## Attendees\n\n## Notes\n\n## Actions\n',
  },
  {
    key: 'spec',
    label: 'Spec',
    title: 'Spec',
    path: 'specs/new-spec',
    content: '# Spec\n\n## Problem\n\n## Goals\n\n## Non-goals\n\n## Design\n\n## Rollout\n',
  },
] as const

const dirty = computed(
  () =>
    title.value !== savedTitle.value ||
    path.value !== savedPath.value ||
    content.value !== savedContent.value ||
    labelsText.value !== savedLabelsText.value ||
    status.value !== savedStatus.value ||
    reviewAtDate.value !== savedReviewAtDate.value ||
    locale.value !== savedLocale.value,
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

interface DraftSnapshot {
  title: string
  path: string
  content: string
  labelsText: string
  status: 'draft' | 'in-review' | 'verified' | 'outdated'
  reviewAtDate: string
  locale: string
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
}

function markSaved(): void {
  savedTitle.value = title.value
  savedPath.value = path.value
  savedContent.value = content.value
  savedLabelsText.value = labelsText.value
  savedStatus.value = status.value
  savedReviewAtDate.value = reviewAtDate.value
  savedLocale.value = locale.value
}

const labels = (): string[] =>
  labelsText.value
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)

const reviewAt = (): number | null =>
  reviewAtDate.value ? new Date(`${reviewAtDate.value}T00:00:00`).getTime() : null

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
  const template = templates.find((item) => item.key === key)
  if (!template) return
  title.value = template.title
  if (!path.value && template.path) path.value = template.path
  content.value = template.content
}

function setEditorMode(mode: 'markdown' | 'visual'): void {
  if (mode === 'visual' && isEdit.value) collabDisabledForSession.value = true
  editorMode.value = mode
}

// Announce "editing" presence so readers of this page see "… is editing".
usePresence(originalPath, 'editing')

onMounted(async () => {
  if (!auth.canEdit) {
    router.replace({ name: 'login' })
    return
  }
  if (isEdit.value) {
    const target = paramToPath(route.params.path)
    try {
      const page = await Api.getPage(target)
      applyPage(page)
      markSaved()
    } catch (e) {
      error.value = (e as Error).message
    }
  } else {
    path.value = (route.query.path as string) ?? ''
    title.value = ''
    content.value = templates[0].content
    labelsText.value = ''
    status.value = 'draft'
    reviewAtDate.value = ''
    locale.value = 'und'
    originalUpdatedAt.value = null
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
      <select v-if="!isEdit" v-model="selectedTemplate" class="input max-w-48">
        <option v-for="template in templates" :key="template.key" :value="template.key">
          {{ template.label }}
        </option>
      </select>
      <select v-model="status" class="input max-w-40">
        <option value="draft">draft</option>
        <option value="in-review">in-review</option>
        <option value="verified">verified</option>
        <option value="outdated">outdated</option>
      </select>
      <input v-model="reviewAtDate" class="input max-w-42" type="date" :title="t('reviewDate')" />
      <input v-model="locale" class="input max-w-28" placeholder="locale" :title="t('locale')" />
      <button class="btn-primary" :disabled="saving || !title || !path" @click="save">
        {{ saving ? t('saving') : t('save') }}
      </button>
      <button v-if="isEdit" class="btn-ghost" @click="archive">{{ t('archive') }}</button>
      <button v-if="isEdit" class="btn-danger" @click="remove">{{ t('delete') }}</button>
    </div>
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
    <VisualEditor v-if="editorMode === 'visual'" v-model="content" />
    <template v-else-if="isEdit">
      <CollabEditor v-if="useCollaborativeMarkdown" :room="originalPath" @update:modelValue="content = $event" />
      <MarkdownEditor v-else-if="originalPath" v-model="content" />
      <div v-else class="text-gray-400">{{ t('loadingEditor') }}</div>
    </template>
    <MarkdownEditor v-else v-model="content" />
  </div>
</template>
