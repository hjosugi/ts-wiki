<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Api, type SearchHit } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const q = ref((route.query.q as string) ?? '')
const pathPrefix = ref((route.query.pathPrefix as string) ?? '')
const label = ref((route.query.label as string) ?? '')
const status = ref((route.query.status as string) ?? '')
const spaceKey = ref((route.query.spaceKey as string) ?? '')
const locale = ref((route.query.locale as string) ?? '')
const hits = ref<SearchHit[]>([])
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

async function run(): Promise<void> {
  if (!q.value.trim()) {
    hits.value = []
    return
  }
  loading.value = true
  try {
    hits.value = (await Api.search(q.value, 20, {
      pathPrefix: pathPrefix.value || undefined,
      label: label.value || undefined,
      status: status.value || undefined,
      spaceKey: spaceKey.value || undefined,
      locale: locale.value || undefined,
    })).hits
  } finally {
    loading.value = false
  }
}

function onInput(): void {
  router.replace({
    query: {
      q: q.value || undefined,
      pathPrefix: pathPrefix.value || undefined,
      label: label.value || undefined,
      status: status.value || undefined,
      spaceKey: spaceKey.value || undefined,
      locale: locale.value || undefined,
    },
  })
  if (timer) clearTimeout(timer)
  timer = setTimeout(run, 180)
}

watch(
  () => route.query.q,
  (value) => {
    const next = (value as string) ?? ''
    if (next !== q.value) {
      q.value = next
      run()
    }
  },
)

watch(
  () => [route.query.pathPrefix, route.query.label, route.query.status, route.query.spaceKey, route.query.locale],
  ([nextPath, nextLabel, nextStatus, nextSpace, nextLocale]) => {
    pathPrefix.value = (nextPath as string) ?? ''
    label.value = (nextLabel as string) ?? ''
    status.value = (nextStatus as string) ?? ''
    spaceKey.value = (nextSpace as string) ?? ''
    locale.value = (nextLocale as string) ?? ''
    run()
  },
)

run()
</script>

<template>
  <div class="max-w-2xl">
    <div class="space-y-3 mb-6">
      <input
        v-model="q"
        class="input text-lg"
        :placeholder="t('searchTheWiki')"
        @input="onInput"
      />
      <div class="grid grid-cols-1 sm:grid-cols-5 gap-2">
        <input v-model="pathPrefix" class="input text-sm" placeholder="path prefix" @input="onInput" />
        <input v-model="spaceKey" class="input text-sm" placeholder="space" @input="onInput" />
        <input v-model="locale" class="input text-sm" placeholder="locale" @input="onInput" />
        <input v-model="label" class="input text-sm" placeholder="label" @input="onInput" />
        <select v-model="status" class="input text-sm" @change="onInput">
          <option value="">any status</option>
          <option value="draft">draft</option>
          <option value="in-review">in-review</option>
          <option value="verified">verified</option>
          <option value="outdated">outdated</option>
        </select>
      </div>
    </div>

    <p v-if="loading" class="text-gray-400">{{ t('searching') }}</p>
    <p v-else-if="q && !hits.length" class="text-gray-400">{{ t('noResults', { query: q }) }}</p>

    <ul class="space-y-3">
      <li
        v-for="h in hits"
        :key="h.path"
        class="card p-4 hover:border-violet-400 transition"
      >
        <RouterLink :to="'/' + h.path" class="block">
          <div class="font-semibold text-violet-600">{{ h.title }}</div>
          <div class="text-xs text-gray-400 mb-1 font-mono">/{{ h.path }}</div>
          <div class="text-sm text-gray-600 dark:text-gray-300 search-snippet" v-html="h.snippet"></div>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style>
.search-snippet mark {
  background: rgba(139, 92, 246, 0.25);
  color: inherit;
  border-radius: 2px;
  padding: 0 2px;
}
</style>
