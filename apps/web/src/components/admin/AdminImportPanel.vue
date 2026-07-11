<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref } from 'vue'
import { Api, type Page } from '@/lib/api'
import { usePages } from '@/stores/pages'
import { useI18n } from '@/lib/i18n'

const pagesStore = usePages()
const { t } = useI18n()
const path = ref('')
const content = ref('')
const labels = ref('')
const status = ref<Page['status']>('draft')
const importing = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const resultMessage = ref('')
const installingDocs = ref(false)

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function exportSite(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const backup = await Api.exportSite()
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `kawaii-wiki.ts-backup-${backup.exportedAt.slice(0, 10)}.json`)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

async function exportZip(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    downloadBlob(await Api.exportSiteZip(), `kawaii-wiki.ts-${new Date().toISOString().slice(0, 10)}.zip`)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

async function importBackup(files: FileList | null): Promise<void> {
  const file = files?.[0]
  if (!file) return
  importing.value = true
  error.value = null
  try {
    const manifest = JSON.parse(await file.text()) as Parameters<typeof Api.importSite>[0]
    const result = await Api.importSite(manifest)
    const failed = result.results.filter((item) => !item.ok)
    resultMessage.value = `Imported ${result.results.length - failed.length}/${result.results.length} pages${failed.length ? `; ${failed.length} failed` : ''}.`
    await pagesStore.refresh()
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    importing.value = false
  }
}

async function importBulk(files: FileList | null): Promise<void> {
  if (!files?.length) return
  importing.value = true
  error.value = null
  try {
    const result = await Api.importBulk([...files])
    const failed = result.results.filter((item) => !item.ok)
    resultMessage.value = `Imported ${result.results.length - failed.length}/${result.results.length} Markdown files${failed.length ? `; ${failed.length} failed` : ''}.`
    await pagesStore.refresh()
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    importing.value = false
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
    error.value = friendlyError(e)
  } finally {
    importing.value = false
  }
}

async function installOfficialDocs(): Promise<void> {
  installingDocs.value = true
  error.value = null
  try {
    const result = await Api.installOfficialDocs()
    resultMessage.value = `Official documentation ${result.version}: ${result.results.length} pages installed or updated.`
    await pagesStore.refresh()
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    installingDocs.value = false
  }
}
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">{{ t('backupAndImport') }}</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-else-if="resultMessage" class="mb-3 text-sm text-emerald-700 dark:text-emerald-300">{{ resultMessage }}</p>
    <div class="admin-import-grid">
      <section class="admin-full-row card p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="max-w-2xl">
            <h3 class="font-semibold">{{ t('officialDocumentation') }}</h3>
            <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('officialDocumentationHint') }}</p>
          </div>
          <button class="btn-primary" type="button" :disabled="installingDocs" @click="installOfficialDocs">{{ installingDocs ? t('installing') : t('installUpdateDocs') }}</button>
        </div>
      </section>
      <section class="card p-4">
        <h3 class="font-semibold mb-3">{{ t('siteExport') }}</h3>
        <div class="flex flex-wrap gap-2">
          <button class="btn-primary" type="button" :disabled="loading" @click="exportSite">{{ t('downloadJson') }}</button>
          <button class="btn-ghost" type="button" :disabled="loading" @click="exportZip">{{ t('downloadMarkdownZip') }}</button>
        </div>
        <label class="mt-4 grid gap-1 text-sm"><span>{{ t('restoreJsonBackup') }}</span><input type="file" accept="application/json,.json" :disabled="importing" @change="importBackup(($event.target as HTMLInputElement).files)" /></label>
      </section>
      <form class="card p-4 space-y-3" @submit.prevent="importMarkdown">
        <h3 class="font-semibold">{{ t('markdownImport') }}</h3>
        <input v-model="path" class="input" placeholder="path/to/page" aria-label="Page path" />
        <textarea v-model="content" class="input min-h-40 font-mono text-sm" :placeholder="t('markdownContent')" :aria-label="t('markdownContent')"></textarea>
        <input v-model="labels" class="input" :placeholder="t('labelsCommaSeparated')" :aria-label="t('labels')" />
        <select v-model="status" class="input" aria-label="Page status"><option value="draft">draft</option><option value="in-review">in-review</option><option value="verified">verified</option><option value="outdated">outdated</option></select>
        <button class="btn-primary" type="submit" :disabled="importing || !path || !content">{{ importing ? t('importing') : t('importMarkdown') }}</button>
      </form>
      <section class="admin-full-row card p-4">
        <h3 class="font-semibold">{{ t('bulkMarkdownImport') }}</h3>
        <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('bulkMarkdownImportHint') }}</p>
        <input class="mt-3" type="file" accept="text/markdown,.md,application/zip,.zip" multiple :disabled="importing" @change="importBulk(($event.target as HTMLInputElement).files)" />
      </section>
    </div>
  </section>
</template>
