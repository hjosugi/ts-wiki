<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Api, type Page } from '@/lib/api'
import { setPageMeta } from '@/lib/meta'
import { useI18n } from '@/lib/i18n'
import { useMarkdownFeatures } from '@/composables/useMarkdownFeatures'
import { vMarkdownEnhance } from '@/lib/markdownEnhance'
import Skeleton from '@/components/Skeleton.vue'

const route = useRoute()
const { t } = useI18n()
const { markdownFeatures } = useMarkdownFeatures()

const page = ref<Page | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const token = computed(() => String(route.params.token ?? ''))

async function load(): Promise<void> {
  if (!token.value) return
  loading.value = true
  error.value = null
  page.value = null
  try {
    const shared = await Api.sharedPage(token.value)
    page.value = shared.page
    setPageMeta(shared.page)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

watch(token, load, { immediate: true })
</script>

<template>
  <main class="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
    <article class="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <Skeleton v-if="loading" :label="t('loading')" title :lines="5" />

      <div v-else-if="page">
        <div class="mb-6 border-b border-gray-200 pb-5 dark:border-gray-800">
          <p class="accent-text mb-2 text-xs font-semibold uppercase tracking-wide">
            {{ t('sharedPage') }}
          </p>
          <h1 class="text-3xl font-bold tracking-tight text-gray-950 dark:text-gray-50">{{ page.title }}</h1>
          <p class="mt-2 font-mono text-sm text-gray-500">/{{ page.path }}</p>
        </div>
        <div v-markdown-enhance="markdownFeatures" class="prose max-w-none dark:prose-invert" v-html="page.renderedHtml"></div>
      </div>

      <div v-else class="rounded border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h1 class="text-xl font-semibold">{{ t('sharedPageUnavailable') }}</h1>
        <p v-if="error" class="mt-2 text-sm text-gray-500">{{ error }}</p>
      </div>
    </article>
  </main>
</template>
