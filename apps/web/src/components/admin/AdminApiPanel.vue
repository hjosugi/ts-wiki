<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()
const origin = window.location.origin
const example = computed(() => `curl -H "Authorization: Bearer YOUR_API_KEY" \\\n+  "${origin}/api/pages?limit=20"`)
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold">{{ t('developerApi') }}</h2>
      <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('developerApiDescription') }}</p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <section class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">REST API</h3>
            <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('restApiReady') }}</p>
          </div>
          <span class="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{{ t('available') }}</span>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <a class="btn-primary" href="/api/docs" target="_blank" rel="noopener">{{ t('openApiExplorer') }}</a>
          <a class="btn-ghost" href="/api/docs/openapi.json" target="_blank" rel="noopener">OpenAPI JSON</a>
        </div>
      </section>

      <section class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">GraphQL</h3>
            <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('graphqlNotAvailableDescription') }}</p>
          </div>
          <span class="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">{{ t('notAvailable') }}</span>
        </div>
      </section>
    </div>

    <section class="card p-4">
      <h3 class="font-semibold">{{ t('authentication') }}</h3>
      <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('apiAuthenticationDescription') }}</p>
      <pre class="mt-3 max-w-full overflow-x-auto rounded-md bg-[var(--c-code-bg)] p-3 text-xs"><code>{{ example }}</code></pre>
    </section>
  </section>
</template>
