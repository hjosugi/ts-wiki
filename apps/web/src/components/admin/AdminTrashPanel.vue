<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type PageSummary } from '@/lib/api'
import { usePages } from '@/stores/pages'

const pagesStore = usePages()
const trash = ref<PageSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    trash.value = await Api.trashPages()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function restorePage(path: string): Promise<void> {
  error.value = null
  try {
    await Api.restorePage(path)
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function purgePage(path: string): Promise<void> {
  if (!confirm(`Purge "/${path}" permanently?`)) return
  error.value = null
  try {
    await Api.purgePage(path)
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Trash and Archive</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
          <tr><th class="p-3 font-medium">Page</th><th class="p-3 font-medium">State</th><th class="p-3 font-medium w-52">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-if="!trash.length"><td class="p-3 text-gray-500" colspan="3">{{ loading ? 'Loading...' : 'No archived or trashed pages.' }}</td></tr>
          <tr v-for="page in trash" :key="page.path" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
            <td class="p-3"><div class="font-medium">{{ page.title }}</div><div class="text-xs font-mono text-gray-500">/{{ page.path }}</div></td>
            <td class="p-3 text-gray-500">{{ page.lifecycle }}</td>
            <td class="p-3"><div class="flex flex-wrap gap-2"><button class="btn-ghost" type="button" @click="restorePage(page.path)">Restore</button><button class="btn-danger" type="button" @click="purgePage(page.path)">Purge</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
