<script setup lang="ts">
import { computed, ref } from 'vue'
import { Api, type GitStatus } from '@/lib/api'
import { useAsyncData } from '@/composables/useAsyncData'
import { useToast } from '@/composables/useToast'
import { useI18n } from '@/lib/i18n'
import Skeleton from '@/components/Skeleton.vue'

const state = useAsyncData(Api.gitStatus)
const syncing = ref(false)
const toast = useToast()
const { formatDateTime, t } = useI18n()
const repositoryUrl = ref('https://github.com/OWNER/wiki-content.git')
const branch = ref('main')
const authorName = ref('Wiki Editor')
const authorEmail = ref('wiki@example.com')
const copied = ref(false)
const configuration = computed(() => [
  'KAWAII_WIKI_GIT_ENABLED=true',
  `KAWAII_WIKI_GIT_REMOTE_URL=${repositoryUrl.value.trim()}`,
  `KAWAII_WIKI_GIT_BRANCH=${branch.value.trim() || 'main'}`,
  `KAWAII_WIKI_GIT_AUTHOR_NAME=${authorName.value.trim() || 'Wiki Editor'}`,
  `KAWAII_WIKI_GIT_AUTHOR_EMAIL=${authorEmail.value.trim() || 'wiki@example.com'}`,
  'KAWAII_WIKI_GIT_SYNC_INTERVAL_MS=300000',
].join('\n'))
const safeRemoteUrl = computed(() => status()?.remoteUrl?.replace(/:\/\/[^/@]+@/, '://***@') ?? null)

const copyConfiguration = async (): Promise<void> => {
  await navigator.clipboard?.writeText(configuration.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1200)
}

const sync = async (): Promise<void> => {
  syncing.value = true
  try {
    const result = await Api.gitSync()
    toast.success(`Git sync completed: ${result.upserted.length} imported, ${result.deleted.length} deleted.`)
    await state.reload()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    syncing.value = false
  }
}

const status = (): GitStatus | undefined => state.data.value
</script>

<template>
  <section>
    <div class="mb-3 flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ t('gitMirror') }}</h2>
        <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('gitMirrorDescription') }}</p>
      </div>
      <button v-if="status()?.enabled" class="btn-primary" type="button" :disabled="syncing" @click="sync">{{ syncing ? t('syncing') : t('syncNow') }}</button>
    </div>
    <Skeleton v-if="state.loading.value" label="Loading Git status" :lines="4" />
    <div v-else-if="status()?.enabled" class="card grid gap-3 p-4 text-sm sm:grid-cols-2">
      <div><span class="text-[var(--c-text-muted)]">{{ t('state') }}</span><div class="font-medium text-emerald-700 dark:text-emerald-300">{{ t('enabled') }}</div></div>
      <div><span class="text-[var(--c-text-muted)]">{{ t('branch') }}</span><div class="font-mono">{{ status()?.branch }}</div></div>
      <div><span class="text-[var(--c-text-muted)]">{{ t('remote') }}</span><div class="break-all font-mono">{{ safeRemoteUrl || status()?.remote || t('none') }}</div></div>
      <div><span class="text-[var(--c-text-muted)]">HEAD</span><div class="break-all font-mono">{{ status()?.head || t('none') }}</div></div>
      <div><span class="text-[var(--c-text-muted)]">{{ t('lastSuccess') }}</span><div>{{ status()?.lastSuccessAt ? formatDateTime(status()!.lastSuccessAt!) : t('never') }}</div></div>
      <div><span class="text-[var(--c-text-muted)]">{{ t('workTree') }}</span><div>{{ status()?.clean ? t('clean') : t('hasChanges') }}</div></div>
      <div v-if="status()?.lastError" class="sm:col-span-2 rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:bg-red-950/30 dark:text-red-200">
        <strong>{{ t('lastError') }}{{ status()?.lastErrorAt ? ` (${formatDateTime(status()!.lastErrorAt!)})` : '' }}</strong>
        <p class="mt-1 whitespace-pre-wrap">{{ status()?.lastError }}</p>
      </div>
    </div>
    <div v-else-if="status()" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
      <section class="card p-4">
        <h3 class="font-semibold">{{ t('connectGitRepository') }}</h3>
        <ol class="mt-2 list-decimal space-y-2 pl-5 text-sm text-[var(--c-text-muted)]">
          <li>{{ t('gitSetupStepRepository') }}</li>
          <li>{{ t('gitSetupStepVariables') }}</li>
          <li>{{ t('gitSetupStepRedeploy') }}</li>
        </ol>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <label class="sm:col-span-2"><span class="mb-1 block text-sm font-medium">{{ t('repositoryUrl') }}</span><input v-model="repositoryUrl" class="input font-mono text-sm" /></label>
          <label><span class="mb-1 block text-sm font-medium">{{ t('branch') }}</span><input v-model="branch" class="input font-mono text-sm" /></label>
          <span></span>
          <label><span class="mb-1 block text-sm font-medium">{{ t('gitAuthorName') }}</span><input v-model="authorName" class="input text-sm" /></label>
          <label><span class="mb-1 block text-sm font-medium">{{ t('gitAuthorEmail') }}</span><input v-model="authorEmail" class="input text-sm" type="email" /></label>
        </div>
        <p class="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{{ t('gitCredentialWarning') }}</p>
      </section>
      <section class="card min-w-0 p-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="font-semibold">{{ t('railwayVariables') }}</h3>
          <button class="btn-ghost" type="button" @click="copyConfiguration">{{ copied ? t('copied') : t('copy') }}</button>
        </div>
        <pre class="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[var(--c-code-bg)] p-3 text-xs"><code>{{ configuration }}</code></pre>
        <p class="mt-3 text-xs text-[var(--c-text-muted)]">{{ t('gitMirrorNotBackup') }}</p>
      </section>
    </div>
  </section>
</template>
