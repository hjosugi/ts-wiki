<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Page } from '@/lib/api'
import WikiBreadcrumbs from '@/components/WikiBreadcrumbs.vue'

const props = defineProps<{
  page: Page
  canEdit: boolean
}>()

const copied = ref(false)

const updated = computed(() =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(props.page.updatedAt)),
)

const childPath = computed(() => `${props.page.path}/new-page`)

async function copyPath(): Promise<void> {
  await navigator.clipboard?.writeText('/' + props.page.path)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1200)
}
</script>

<template>
  <header class="border-b border-gray-200 dark:border-gray-800 pb-5 mb-7">
    <WikiBreadcrumbs :path="page.path" />

    <div class="flex flex-wrap items-start justify-between gap-4 mt-3">
      <div class="min-w-0">
        <h1 class="text-3xl font-bold tracking-tight text-gray-950 dark:text-gray-50">{{ page.title }}</h1>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
          <span class="font-mono">/{{ page.path }}</span>
          <span>Updated {{ updated }}</span>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 shrink-0">
        <button class="btn-ghost" type="button" @click="copyPath">
          {{ copied ? 'Copied' : 'Copy path' }}
        </button>
        <RouterLink v-if="canEdit" :to="{ name: 'new', query: { path: childPath } }" class="btn-ghost">
          New child
        </RouterLink>
        <RouterLink :to="'/_history/' + page.path" class="btn-ghost">
          History
        </RouterLink>
        <RouterLink v-if="canEdit" :to="'/_edit/' + page.path" class="btn-primary">
          Edit
        </RouterLink>
      </div>
    </div>
  </header>
</template>
