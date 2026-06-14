<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { usePresence } from '@/composables/usePresence'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const pagesStore = usePages()

const isEdit = computed(() => route.name === 'edit')
const title = ref('')
const path = ref('')
const originalPath = ref('')
const content = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

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
    } catch (e) {
      error.value = (e as Error).message
    }
  } else {
    path.value = (route.query.path as string) ?? ''
    title.value = ''
    content.value = '# New page\n\nStart writing in **Markdown**…\n'
  }
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
    router.push('/' + path.value)
  } catch (e) {
    error.value = (e as Error).message
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
      <button class="btn-primary" :disabled="saving || !title || !path" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
      <button v-if="isEdit" class="btn-danger" @click="remove">Delete</button>
    </div>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <MarkdownEditor v-model="content" />
  </div>
</template>
