<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { computed, ref } from 'vue'
import { Api, type AssetUsagePage, type AssetView } from '@/lib/api'
import { displayAssetFolder } from '@/lib/assets'
import Skeleton from '@/components/Skeleton.vue'
import { useDialogs } from '@/composables/useDialogs'
import { useAsyncData } from '@/composables/useAsyncData'

const assets = ref<AssetView[]>([])
const folders = ref<string[]>([])
const folderFilter = ref('')
const query = ref('')
const usageByAssetId = ref<Record<string, AssetUsagePage[]>>({})
const orphanAssetIds = ref<string[]>([])
const selectedOrphanIds = ref<string[]>([])
const cleaning = ref(false)
const dialogs = useDialogs()

const formatBytes = (value: number): string =>
  value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`

const { loading, error, reload: load } = useAsyncData(async () => {
    const [nextAssets, nextUsage, nextOrphans, nextFolders] = await Promise.all([
      Api.listAssets(folderFilter.value || undefined, query.value || undefined),
      Api.assetUsage(),
      Api.orphanAssets(),
      Api.assetFolders(),
    ])
    assets.value = nextAssets
    folders.value = nextFolders
    usageByAssetId.value = Object.fromEntries(nextUsage.map((entry) => [entry.asset.id, entry.pages]))
    orphanAssetIds.value = nextOrphans.map((asset) => asset.id)
    selectedOrphanIds.value = selectedOrphanIds.value.filter((id) => orphanAssetIds.value.includes(id))
})

async function deleteAsset(asset: AssetView): Promise<void> {
  if (!await dialogs.confirm({ message: `Delete asset "${asset.filename}"?`, danger: true })) return
  error.value = null
  try {
    await Api.deleteAsset(asset.id)
    assets.value = assets.value.filter((item) => item.id !== asset.id)
    const nextUsage = { ...usageByAssetId.value }
    delete nextUsage[asset.id]
    usageByAssetId.value = nextUsage
    orphanAssetIds.value = orphanAssetIds.value.filter((id) => id !== asset.id)
    selectedOrphanIds.value = selectedOrphanIds.value.filter((id) => id !== asset.id)
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function renameAsset(asset: AssetView, filename: string): Promise<void> {
  filename = filename.trim()
  if (!filename || filename === asset.filename) return
  error.value = null
  try {
    const renamed = await Api.renameAsset(asset.id, filename)
    assets.value = assets.value.map((item) => (item.id === renamed.id ? renamed : item))
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function updateAssetFolder(asset: AssetView, folder: string): Promise<void> {
  folder = folder.trim()
  if (folder === asset.folder) return
  error.value = null
  try {
    await Api.updateAsset(asset.id, { folder })
    await load()
  } catch (e) {
    error.value = friendlyError(e)
  }
}

const usedOn = (asset: AssetView): AssetUsagePage[] => usageByAssetId.value[asset.id] ?? []
const orphanIdSet = computed(() => new Set(orphanAssetIds.value))
const orphanAssets = computed(() => assets.value.filter((asset) => orphanIdSet.value.has(asset.id)))
const isOrphan = (asset: AssetView): boolean => orphanIdSet.value.has(asset.id)
const isSelected = (asset: AssetView): boolean => selectedOrphanIds.value.includes(asset.id)

function toggleOrphan(asset: AssetView): void {
  if (!isOrphan(asset)) return
  selectedOrphanIds.value = isSelected(asset)
    ? selectedOrphanIds.value.filter((id) => id !== asset.id)
    : [...selectedOrphanIds.value, asset.id]
}

function selectAllOrphans(): void {
  selectedOrphanIds.value = orphanAssets.value.map((asset) => asset.id)
}

function clearSelection(): void {
  selectedOrphanIds.value = []
}

async function deleteSelectedOrphans(): Promise<void> {
  const ids = [...selectedOrphanIds.value]
  if (!ids.length) return
  if (!await dialogs.confirm({ message: `Move ${ids.length} orphaned asset${ids.length === 1 ? '' : 's'} to trash?`, danger: true })) return
  cleaning.value = true
  error.value = null
  try {
    const result = await Api.deleteOrphanAssets(ids)
    selectedOrphanIds.value = []
    await load()
    if (result.skipped) {
      error.value = `${result.skipped} selected asset${result.skipped === 1 ? '' : 's'} skipped because it is now used.`
    }
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    cleaning.value = false
  }
}

</script>

<template>
  <section>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">Assets</h2>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model.trim="folderFilter"
          class="input h-9 w-56 text-sm"
          list="admin-asset-folders"
          placeholder="Folder"
          aria-label="Asset folder"
          @change="load"
        />
        <input
          v-model.trim="query"
          class="input h-9 w-56 text-sm"
          placeholder="Search files"
          aria-label="Search files"
          @input="load"
        />
        <datalist id="admin-asset-folders">
          <option value="" label="Root"></option>
          <option v-for="folder in folders" :key="folder" :value="folder"></option>
        </datalist>
        <button class="btn-ghost" type="button" :disabled="loading" @click="load">
          {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
    </div>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span class="text-gray-500">{{ orphanAssets.length }} orphaned</span>
      <button class="btn-ghost" type="button" :disabled="!orphanAssets.length || cleaning" @click="selectAllOrphans">
        Select all orphans
      </button>
      <button class="btn-ghost" type="button" :disabled="!selectedOrphanIds.length || cleaning" @click="clearSelection">
        Clear selection
      </button>
      <button class="btn-danger" type="button" :disabled="!selectedOrphanIds.length || cleaning" @click="deleteSelectedOrphans">
        {{ cleaning ? 'Deleting...' : `Delete selected (${selectedOrphanIds.length})` }}
      </button>
    </div>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-[var(--c-text-muted)] border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th class="p-3 font-medium w-10">Select</th>
            <th class="p-3 font-medium">File</th>
            <th class="p-3 font-medium">Folder</th>
            <th class="p-3 font-medium">Type</th>
            <th class="p-3 font-medium">Size</th>
            <th class="p-3 font-medium">Used on</th>
            <th class="p-3 font-medium w-32">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !assets.length">
            <td class="p-3" colspan="7"><Skeleton label="Loading assets" :lines="3" /></td>
          </tr>
          <tr v-else-if="!assets.length"><td class="p-3 text-gray-500" colspan="7">No uploaded assets yet.</td></tr>
          <tr v-for="asset in assets" :key="asset.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
            <td class="p-3">
              <input
                v-if="isOrphan(asset)"
                type="checkbox"
                :checked="isSelected(asset)"
                :aria-label="`Select ${asset.filename}`"
                @change="toggleOrphan(asset)"
              />
              <span v-else class="text-xs text-gray-300" aria-hidden="true">--</span>
            </td>
            <td class="p-3">
              <div class="flex items-center gap-3">
                <img
                  v-if="asset.mime.startsWith('image/')"
                  :src="asset.thumbUrl || asset.url"
                  :alt="asset.filename"
                  class="h-12 w-12 rounded bg-gray-100 object-cover dark:bg-gray-900"
                />
                <input
                  class="input max-w-56 text-sm font-medium"
                  :value="asset.filename"
                  :aria-label="`Rename ${asset.filename}`"
                  @change="renameAsset(asset, ($event.target as HTMLInputElement).value)"
                />
              </div>
              <div class="mt-1 text-xs font-mono text-gray-500">{{ asset.url }}</div>
            </td>
            <td class="p-3">
              <input
                class="input max-w-48 text-sm"
                :value="asset.folder"
                list="admin-asset-folders"
                :placeholder="displayAssetFolder('')"
                :aria-label="`Folder for ${asset.filename}`"
                @change="updateAssetFolder(asset, ($event.target as HTMLInputElement).value)"
              />
              <div class="mt-1 text-xs text-gray-500">{{ displayAssetFolder(asset.folder) }}</div>
            </td>
            <td class="p-3 text-gray-500">{{ asset.mime }}</td>
            <td class="p-3 text-gray-500">{{ formatBytes(asset.size) }}</td>
            <td class="p-3 text-gray-500">
              <span v-if="!usedOn(asset).length" :class="isOrphan(asset) ? 'text-amber-600 dark:text-amber-400' : ''">
                {{ isOrphan(asset) ? 'Orphan' : 'Unused' }}
              </span>
              <div v-else class="flex flex-wrap gap-1.5">
                <RouterLink
                  v-for="page in usedOn(asset).slice(0, 3)"
                  :key="page.path"
                  :to="'/' + page.path"
                  class="accent-border-hover rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 dark:border-gray-800 dark:text-gray-300"
                >
                  {{ page.title }}
                </RouterLink>
                <span v-if="usedOn(asset).length > 3" class="px-2 py-0.5 text-xs text-[var(--c-text-muted)]">
                  +{{ usedOn(asset).length - 3 }}
                </span>
              </div>
            </td>
            <td class="p-3"><button class="btn-danger" type="button" @click="deleteAsset(asset)">Delete</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
