<script setup lang="ts">
import type { AssetView } from '@/lib/api'
import Skeleton from '@/components/Skeleton.vue'

const props = withDefaults(defineProps<{
  assets: AssetView[]
  loading?: boolean
  showEmpty?: boolean
}>(), {
  loading: false,
  showEmpty: false,
})

const formatBytes = (value: number): string =>
  value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(value / 1024))} KB`

const fileKind = (asset: AssetView): string =>
  asset.mime.startsWith('image/') ? 'IMG' : asset.filename.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'
</script>

<template>
  <section id="attachments" v-if="loading || assets.length || props.showEmpty" class="mt-10 border-t border-gray-200 pt-5 dark:border-gray-800">
    <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Attachments</h2>
    <Skeleton v-if="loading" class="mt-3" label="Loading attachments" :lines="2" />
    <p v-else-if="!assets.length" class="mt-3 text-sm text-gray-500">No uploaded assets referenced by this page.</p>
    <div v-else class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <a
        v-for="asset in assets"
        :key="asset.id"
        :href="asset.url"
        target="_blank"
        rel="noopener noreferrer"
        class="accent-border-hover group flex min-w-0 items-center gap-3 rounded-md border border-gray-200 p-2 dark:border-gray-800"
      >
        <img
          v-if="asset.mime.startsWith('image/')"
          :src="asset.url"
          :alt="asset.filename"
          class="h-12 w-12 shrink-0 rounded bg-gray-100 object-cover dark:bg-gray-900"
        />
        <span
          v-else
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-900"
        >
          {{ fileKind(asset) }}
        </span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium group-hover:text-[var(--c-accent-text)]">{{ asset.filename }}</span>
          <span class="block truncate text-xs text-gray-500">{{ asset.mime }} / {{ formatBytes(asset.size) }}</span>
        </span>
      </a>
    </div>
  </section>
</template>
