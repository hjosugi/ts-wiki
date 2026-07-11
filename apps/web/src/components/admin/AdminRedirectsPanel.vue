<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref } from 'vue'
import { Api, type PageRedirectView } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import Skeleton from '@/components/Skeleton.vue'
import { useDialogs } from '@/composables/useDialogs'
import { useAsyncData } from '@/composables/useAsyncData'

const { data: redirects, loading, error, reload: load } = useAsyncData<PageRedirectView[]>(Api.redirects, { initial: [] })
const fromPath = ref('')
const toPath = ref('')
const { formatDateTime, t } = useI18n()
const dialogs = useDialogs()

async function createRedirect(): Promise<void> {
  error.value = null
  try {
    const redirect = await Api.createRedirect(fromPath.value, toPath.value)
    redirects.value = [...redirects.value.filter((item) => item.fromPath !== redirect.fromPath), redirect]
      .sort((a, b) => a.fromPath.localeCompare(b.fromPath))
    fromPath.value = ''
    toPath.value = ''
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function deleteRedirect(redirect: PageRedirectView): Promise<void> {
  if (!await dialogs.confirm({ message: `Delete redirect "/${redirect.fromPath}"?`, danger: true })) return
  error.value = null
  try {
    await Api.deleteRedirect(redirect.fromPath)
    redirects.value = redirects.value.filter((item) => item.fromPath !== redirect.fromPath)
  } catch (e) {
    error.value = friendlyError(e)
  }
}

</script>

<template>
  <section>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">{{ t('redirectsAndAliases') }}</h2>
      <button class="btn-ghost" type="button" :disabled="loading" @click="load">
        {{ loading ? t('loading') : t('refresh') }}
      </button>
    </div>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <div class="admin-redirect-layout">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-[var(--c-text-muted)] border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th class="p-3 font-medium">{{ t('alias') }}</th>
              <th class="p-3 font-medium">{{ t('target') }}</th>
              <th class="p-3 font-medium">{{ t('created') }}</th>
              <th class="p-3 font-medium w-28">{{ t('actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !redirects.length">
              <td class="p-3" colspan="4"><Skeleton label="Loading redirects" :lines="3" /></td>
            </tr>
            <tr v-else-if="!redirects.length">
              <td class="p-3 text-gray-500" colspan="4">{{ t('noRedirectsYet') }}</td>
            </tr>
            <tr v-for="redirect in redirects" :key="redirect.fromPath" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
              <td class="p-3 font-mono text-gray-700 dark:text-gray-200">/{{ redirect.fromPath }}</td>
              <td class="p-3">
                <RouterLink class="link-quiet font-mono" :to="'/' + redirect.toPath">/{{ redirect.toPath }}</RouterLink>
              </td>
              <td class="p-3 text-gray-500">{{ formatDateTime(redirect.createdAt) }}</td>
              <td class="p-3">
                <button class="btn-danger py-1 text-xs" type="button" @click="deleteRedirect(redirect)">{{ t('delete') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="card p-4 space-y-2" @submit.prevent="createRedirect">
        <input v-model.trim="fromPath" class="input" placeholder="old/path" :aria-label="t('oldPath')" />
        <input v-model.trim="toPath" class="input" placeholder="target/path" :aria-label="t('targetPath')" />
        <button class="btn-primary" type="submit" :disabled="!fromPath || !toPath">{{ t('createAlias') }}</button>
      </form>
    </div>
  </section>
</template>
