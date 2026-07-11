<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref } from 'vue'
import { Api, type AssetView, type PageSummary } from '@/lib/api'
import { usePages } from '@/stores/pages'
import Skeleton from '@/components/Skeleton.vue'
import { useDialogs } from '@/composables/useDialogs'
import { useAsyncData } from '@/composables/useAsyncData'

const pagesStore = usePages()
const dialogs = useDialogs()
const pageTrash = ref<PageSummary[]>([])
const assetTrash = ref<AssetView[]>([])
const { loading, error, reload: load } = useAsyncData(async () => {
  const [pageRows, assetRows] = await Promise.all([Api.trashPages(), Api.trashAssets()])
  pageTrash.value = pageRows
  assetTrash.value = assetRows
})

const formatBytes = (value: number): string =>
  value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(value / 1024))} KB`

async function restorePage(path: string): Promise<void> {
  error.value = null
  try {
    await Api.restorePage(path)
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function purgePage(path: string): Promise<void> {
  if (!await dialogs.confirm({ message: `Purge "/${path}" permanently?`, danger: true })) return
  error.value = null
  try {
    await Api.purgePage(path)
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function restoreAsset(id: string): Promise<void> {
  error.value = null
  try {
    await Api.restoreAsset(id)
    await load()
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function purgeAsset(asset: AssetView): Promise<void> {
  if (!await dialogs.confirm({ message: `Purge asset "${asset.filename}" permanently?`, danger: true })) return
  error.value = null
  try {
    await Api.purgeAsset(asset.id)
    await load()
  } catch (e) {
    error.value = friendlyError(e)
  }
}

</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Trash and Archive</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">Pages</h3>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-[var(--c-text-muted)] border-b border-gray-200 dark:border-gray-800">
          <tr><th class="p-3 font-medium">Page</th><th class="p-3 font-medium">State</th><th class="p-3 font-medium w-52">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-if="loading && !pageTrash.length">
            <td class="p-3" colspan="3"><Skeleton label="Loading trashed pages" :lines="3" /></td>
          </tr>
          <tr v-else-if="!pageTrash.length"><td class="p-3 text-gray-500" colspan="3">No archived or trashed pages.</td></tr>
          <tr v-for="page in pageTrash" :key="page.path" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
            <td class="p-3"><div class="font-medium">{{ page.title }}</div><div class="text-xs font-mono text-gray-500">/{{ page.path }}</div></td>
            <td class="p-3 text-gray-500">{{ page.lifecycle }}</td>
            <td class="p-3"><div class="flex flex-wrap gap-2"><button class="btn-ghost" type="button" @click="restorePage(page.path)">Restore</button><button class="btn-danger" type="button" @click="purgePage(page.path)">Purge</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>
    <h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mt-5 mb-2">Assets</h3>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-[var(--c-text-muted)] border-b border-gray-200 dark:border-gray-800">
          <tr><th class="p-3 font-medium">Asset</th><th class="p-3 font-medium">Type</th><th class="p-3 font-medium">Size</th><th class="p-3 font-medium w-52">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-if="loading && !assetTrash.length">
            <td class="p-3" colspan="4"><Skeleton label="Loading trashed assets" :lines="3" /></td>
          </tr>
          <tr v-else-if="!assetTrash.length"><td class="p-3 text-gray-500" colspan="4">No trashed assets.</td></tr>
          <tr v-for="asset in assetTrash" :key="asset.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
            <td class="p-3"><div class="font-medium">{{ asset.filename }}</div><div class="text-xs font-mono text-gray-500">{{ asset.url }}</div></td>
            <td class="p-3 text-gray-500">{{ asset.mime }}</td>
            <td class="p-3 text-gray-500">{{ formatBytes(asset.size) }}</td>
            <td class="p-3"><div class="flex flex-wrap gap-2"><button class="btn-ghost" type="button" @click="restoreAsset(asset.id)">Restore</button><button class="btn-danger" type="button" @click="purgeAsset(asset)">Purge</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
