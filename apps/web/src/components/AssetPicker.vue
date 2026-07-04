<script setup lang="ts">
import { ref, watch } from 'vue'
import { Api, type AssetView } from '@/lib/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  insert: [markdown: string]
}>()

const assets = ref<AssetView[]>([])
const uploadInput = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const uploading = ref(false)
const error = ref<string | null>(null)

const altText = (filename: string): string => filename.replace(/\.[^.]+$/, '') || 'image'

async function load(): Promise<void> {
  if (!props.open) return
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

async function uploadFiles(files: FileList | null): Promise<void> {
  if (!files?.length) return
  uploading.value = true
  error.value = null
  try {
    for (const file of Array.from(files)) {
      await Api.uploadAsset(file)
    }
    await load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    uploading.value = false
    if (uploadInput.value) uploadInput.value.value = ''
  }
}

function insert(asset: AssetView): void {
  const label = altText(asset.filename)
  emit('insert', asset.mime.startsWith('image/') ? `![${label}](${asset.url})\n` : `[${asset.filename}](${asset.url})\n`)
}

watch(() => props.open, load, { immediate: true })
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-40 bg-gray-950/50 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    @click.self="emit('close')"
  >
    <section class="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950">
      <div class="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h2 class="font-semibold">Assets</h2>
        <div class="flex items-center gap-2">
          <button class="btn-ghost" type="button" :disabled="uploading" @click="uploadInput?.click()">
            {{ uploading ? 'Uploading...' : 'Upload' }}
          </button>
          <button class="btn-ghost" type="button" @click="emit('close')">Close</button>
        </div>
        <input
          ref="uploadInput"
          class="hidden"
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.csv,.json,.zip,.docx,.xlsx,.pptx,.odt,.ods,.odp"
          @change="uploadFiles(($event.target as HTMLInputElement).files)"
        />
      </div>

      <div class="max-h-[calc(80vh-3.5rem)] overflow-auto p-4">
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <p v-else-if="loading" class="text-gray-400">Loading...</p>
        <p v-else-if="!assets.length" class="text-gray-500">No uploaded assets yet.</p>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            v-for="asset in assets"
            :key="asset.id"
            class="text-left rounded-md border border-gray-200 p-3 hover:border-violet-400 dark:border-gray-800"
            type="button"
            @click="insert(asset)"
          >
            <img
              v-if="asset.mime.startsWith('image/')"
              :src="asset.url"
              :alt="asset.filename"
              class="mb-2 h-28 w-full rounded object-contain bg-gray-100 dark:bg-gray-900"
            />
            <div class="truncate font-medium">{{ asset.filename }}</div>
            <div class="mt-1 truncate font-mono text-xs text-gray-500">{{ asset.url }}</div>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
