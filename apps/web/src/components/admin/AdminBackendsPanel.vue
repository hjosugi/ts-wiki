<script setup lang="ts">
import { computed, ref } from 'vue'
import { Api, type SystemBackendsStatus } from '@/lib/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useI18n } from '@/lib/i18n'
import AdminAsyncState from './AdminAsyncState.vue'

type DatabaseDriver = SystemBackendsStatus['database']['driver']
type AssetBackend = SystemBackendsStatus['assets']['backend']

const { t } = useI18n()
const { data: backends, loading, error, reload } = useAsyncData<SystemBackendsStatus | null>(Api.adminBackends, { initial: null })

const chipClass = (healthy: boolean): string =>
  `shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${
    healthy
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
  }`

// Placeholder env templates (never real secrets) for the configuration
// generator. Variable names mirror env.ts; values are stand-ins the operator
// replaces in their own environment.
const DATABASE_CONFIGS: Record<DatabaseDriver, string> = {
  sqlite: 'DATABASE_DRIVER=sqlite\n# DATABASE_PATH=/data/ts-wiki.sqlite   # optional; defaults under DATA_DIR',
  libsql: 'DATABASE_DRIVER=libsql\nLIBSQL_URL=libsql://your-db.turso.io\nLIBSQL_AUTH_TOKEN=<auth-token>\n# LIBSQL_REPLICA_PATH=/data/replica.db   # optional embedded replica',
  postgres: 'DATABASE_DRIVER=postgres\nDATABASE_URL=postgres://user:password@host:5432/db\nDATABASE_SSL=require\n# DATABASE_POOL_MAX=10   # optional',
  mysql: 'DATABASE_DRIVER=mysql\nDATABASE_URL=mysql://user:password@host:3306/db\nDATABASE_SSL=require\n# DATABASE_POOL_MAX=10   # optional',
}
const ASSET_CONFIGS: Record<AssetBackend, string> = {
  local: 'ASSET_STORAGE=local\n# ASSET_PUBLIC_BASE_URL=https://cdn.example.com   # optional',
  r2: 'ASSET_STORAGE=r2\nR2_ACCESS_KEY_ID=<access-key-id>\nR2_SECRET_ACCESS_KEY=<secret-access-key>\nR2_BUCKET=<bucket>\nR2_ACCOUNT_ID=<account-id>\n# or set R2_ENDPOINT instead of R2_ACCOUNT_ID',
}

const databaseTarget = ref<DatabaseDriver>('postgres')
const assetTarget = ref<AssetBackend>('r2')
const databaseConfig = computed(() => DATABASE_CONFIGS[databaseTarget.value])
const assetConfig = computed(() => ASSET_CONFIGS[assetTarget.value])
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

    <section class="card space-y-3 p-4">
      <div>
        <h3 class="font-semibold">{{ t('backendConfig') }}</h3>
        <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('backendConfigDescription') }}</p>
      </div>

      <div class="admin-api-grid">
        <div class="space-y-2">
          <label class="block text-sm font-medium">
            {{ t('backendDatabase') }}
            <select v-model="databaseTarget" class="input mt-1">
              <option value="sqlite">sqlite</option>
              <option value="libsql">libsql</option>
              <option value="postgres">postgres</option>
              <option value="mysql">mysql</option>
            </select>
          </label>
          <pre class="max-w-full overflow-x-auto rounded-md bg-[var(--c-code-bg)] p-3 text-xs"><code>{{ databaseConfig }}</code></pre>
        </div>

        <div class="space-y-2">
          <label class="block text-sm font-medium">
            {{ t('backendAssets') }}
            <select v-model="assetTarget" class="input mt-1">
              <option value="local">local</option>
              <option value="r2">r2</option>
            </select>
          </label>
          <pre class="max-w-full overflow-x-auto rounded-md bg-[var(--c-code-bg)] p-3 text-xs"><code>{{ assetConfig }}</code></pre>
        </div>
      </div>

      <p class="text-xs text-[var(--c-text-muted)]">{{ t('backendConfigGuidance') }}</p>
    </section>
  </section>
</template>
