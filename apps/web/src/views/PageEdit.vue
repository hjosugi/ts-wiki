<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { Api } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import { usePresence } from '@/composables/usePresence'

const MarkdownEditor = defineAsyncComponent(() => import('@/components/MarkdownEditor.vue'))
const CollabEditor = defineAsyncComponent(() => import('@/components/CollabEditor.vue'))

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const pagesStore = usePages()

const isEdit = computed(() => route.name === 'edit')
const title = ref('')
const path = ref('')
const originalPath = ref('')
const content = ref('')
const savedTitle = ref('')
const savedPath = ref('')
const savedContent = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const selectedTemplate = ref('blank')

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
    content.value !== savedContent.value,
)
const saveStatus = computed(() => {
  if (saving.value) return 'Saving...'
  if (error.value) return 'Save failed'
  if (dirty.value) return 'Unsaved changes'
  return 'Saved'
})

function markSaved(): void {
  savedTitle.value = title.value
  savedPath.value = path.value
  savedContent.value = content.value
}

function applyTemplate(key: string): void {
  const template = templates.find((item) => item.key === key)
  if (!template) return
  title.value = template.title
  if (!path.value && template.path) path.value = template.path
  content.value = template.content
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
      title.value = page.title
      path.value = page.path
      originalPath.value = page.path
      content.value = page.content
      markSaved()
    } catch (e) {
      error.value = (e as Error).message
    }
  } else {
    path.value = (route.query.path as string) ?? ''
    title.value = ''
    content.value = templates[0].content
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
  return confirm('Discard unsaved changes?')
})

async function save(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    if (isEdit.value) {
      const updated = await Api.updatePage(originalPath.value, { title: title.value, content: content.value })
      if (path.value !== originalPath.value) {
        const moved = await Api.movePage(originalPath.value, path.value)
        path.value = moved.path
        originalPath.value = moved.path
      } else {
        path.value = updated.path
        originalPath.value = updated.path
      }
    } else {
      await Api.createPage({ path: path.value, title: title.value, content: content.value })
    }
    await pagesStore.refresh()
    markSaved()
    router.push('/' + path.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  if (!confirm(`Delete "${title.value}"? This cannot be undone.`)) return
  try {
    await Api.deletePage(path.value)
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
      <input v-model="title" class="input flex-1 min-w-50 text-lg font-semibold" placeholder="Page title" />
      <input
        v-model="path"
        class="input font-mono text-sm max-w-xs"
        placeholder="path/to/page"
      />
      <select v-if="!isEdit" v-model="selectedTemplate" class="input max-w-48">
        <option v-for="template in templates" :key="template.key" :value="template.key">
          {{ template.label }}
        </option>
      </select>
      <button class="btn-primary" :disabled="saving || !title || !path" @click="save">
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
      <button v-if="isEdit" class="btn-danger" @click="remove">Delete</button>
    </div>
    <div class="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <span
        class="font-medium"
        :class="error ? 'text-red-600' : dirty ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'"
      >
        {{ saveStatus }}
      </span>
      <RouterLink v-if="isEdit && originalPath" class="link-quiet" :to="'/_history/' + originalPath">
        History
      </RouterLink>
    </div>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <!-- Existing pages → collaborative (Yjs) editor; new pages → solo editor. -->
    <template v-if="isEdit">
      <CollabEditor v-if="originalPath" :room="originalPath" @update:modelValue="content = $event" />
      <div v-else class="text-gray-400">Loading editor…</div>
    </template>
    <MarkdownEditor v-else v-model="content" />
  </div>
</template>
