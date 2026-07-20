<script setup lang="ts">
import { Api, type SystemBackendsStatus } from '@/lib/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useI18n } from '@/lib/i18n'
import AdminAsyncState from './AdminAsyncState.vue'

const { t } = useI18n()
const { data: backends, loading, error, reload } = useAsyncData<SystemBackendsStatus | null>(Api.adminBackends, { initial: null })

const chipClass = (healthy: boolean): string =>
  `shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${
    healthy
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
  }`
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold">{{ t('adminBackends') }}</h2>
      <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('adminBackendsDescription') }}</p>
    </div>

    <AdminAsyncState :error="error" :loading="loading" @retry="reload" />

    <div v-if="backends" class="admin-api-grid">
      <section class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">{{ t('backendDatabase') }}</h3>
            <p class="mt-1 font-mono text-sm text-[var(--c-text-muted)]">{{ backends.database.driver }}</p>
          </div>
          <span :class="chipClass(backends.database.healthy)">{{ t(backends.database.healthy ? 'backendHealthy' : 'backendUnhealthy') }}</span>
        </div>
      </section>

      <section class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">{{ t('backendSearch') }}</h3>
            <p class="mt-1 font-mono text-sm text-[var(--c-text-muted)]">{{ backends.search.engine }}</p>
            <p class="mt-0.5 text-xs text-[var(--c-text-muted)]">{{ t('backendSearchBuiltin') }}</p>
          </div>
          <span :class="chipClass(backends.search.healthy)">{{ t(backends.search.healthy ? 'backendHealthy' : 'backendUnhealthy') }}</span>
        </div>
      </section>

      <section class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">{{ t('backendAssets') }}</h3>
            <p class="mt-1 font-mono text-sm text-[var(--c-text-muted)]">{{ backends.assets.backend }}</p>
          </div>
          <span :class="chipClass(backends.assets.healthy)">{{ t(backends.assets.healthy ? 'backendHealthy' : 'backendUnhealthy') }}</span>
        </div>
      </section>
    </div>
  </section>
</template>
