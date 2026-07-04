<script setup lang="ts">
import { ref } from 'vue'
import { Api, type Page } from '@/lib/api'
import { usePages } from '@/stores/pages'

const pagesStore = usePages()
const path = ref('')
const content = ref('')
const labels = ref('')
const status = ref<Page['status']>('draft')
const importing = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

async function exportSite(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const backup = await Api.exportSite()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ts-wiki-backup-${backup.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function importMarkdown(): Promise<void> {
  importing.value = true
  error.value = null
  try {
    await Api.importMarkdown({
      path: path.value,
      content: content.value,
      labels: labels.value.split(',').map((label) => label.trim()).filter(Boolean),
      status: status.value,
    })
    path.value = ''
    content.value = ''
    labels.value = ''
    status.value = 'draft'
    await pagesStore.refresh()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Backup and Import</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section class="card p-4">
        <h3 class="font-semibold mb-3">Site export</h3>
        <button class="btn-primary" type="button" :disabled="loading" @click="exportSite">Download JSON</button>
      </section>
      <form class="card p-4 space-y-3" @submit.prevent="importMarkdown">
        <h3 class="font-semibold">Markdown import</h3>
        <input v-model="path" class="input" placeholder="path/to/page" />
        <textarea v-model="content" class="input min-h-40 font-mono text-sm" placeholder="Markdown with optional frontmatter"></textarea>
        <input v-model="labels" class="input" placeholder="labels, comma separated" />
        <select v-model="status" class="input"><option value="draft">draft</option><option value="in-review">in-review</option><option value="verified">verified</option><option value="outdated">outdated</option></select>
        <button class="btn-primary" type="submit" :disabled="importing || !path || !content">{{ importing ? 'Importing...' : 'Import Markdown' }}</button>
      </form>
    </div>
  </section>
</template>
