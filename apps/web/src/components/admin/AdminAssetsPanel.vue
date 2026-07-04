<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type AssetView } from '@/lib/api'

const assets = ref<AssetView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const formatBytes = (value: number): string =>
  value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    assets.value = await Api.listAssets()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function deleteAsset(asset: AssetView): Promise<void> {
  if (!confirm(`Delete asset "${asset.filename}"?`)) return
  error.value = null
  try {
    await Api.deleteAsset(asset.id)
    assets.value = assets.value.filter((item) => item.id !== asset.id)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function renameAsset(asset: AssetView): Promise<void> {
  const filename = prompt('Asset filename', asset.filename)?.trim()
  if (!filename || filename === asset.filename) return
  error.value = null
  try {
    const renamed = await Api.renameAsset(asset.id, filename)
    assets.value = assets.value.map((item) => (item.id === renamed.id ? renamed : item))
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Assets</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
          <tr><th class="p-3 font-medium">File</th><th class="p-3 font-medium">Type</th><th class="p-3 font-medium">Size</th><th class="p-3 font-medium w-48">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-if="!assets.length"><td class="p-3 text-gray-500" colspan="4">{{ loading ? 'Loading...' : 'No uploaded assets yet.' }}</td></tr>
          <tr v-for="asset in assets" :key="asset.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
            <td class="p-3"><a :href="asset.url" class="link-quiet font-medium" target="_blank" rel="noopener noreferrer">{{ asset.filename }}</a><div class="text-xs font-mono text-gray-500">{{ asset.url }}</div></td>
            <td class="p-3 text-gray-500">{{ asset.mime }}</td>
            <td class="p-3 text-gray-500">{{ formatBytes(asset.size) }}</td>
            <td class="p-3"><div class="flex flex-wrap gap-2"><button class="btn-ghost" type="button" @click="renameAsset(asset)">Rename</button><button class="btn-danger" type="button" @click="deleteAsset(asset)">Delete</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
