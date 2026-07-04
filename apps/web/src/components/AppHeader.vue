<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Api, type PublicSettings } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useI18n } from '@/lib/i18n'

const router = useRouter()
const auth = useAuth()
const { t } = useI18n()
const q = ref('')
const settings = ref<PublicSettings>({
  siteTitle: 'ts-wiki',
  accentColor: '#7c3aed',
  theme: 'system',
  navLinks: [],
})
const accentStyle = computed(() => ({ color: settings.value.accentColor }))

function submitSearch(): void {
  const query = q.value.trim()
  if (query) router.push({ name: 'search', query: { q: query } })
}

function openCommandPalette(): void {
  window.dispatchEvent(new Event('open-command-palette'))
}

onMounted(async () => {
  try {
    settings.value = await Api.publicSettings()
    document.title = settings.value.siteTitle
  } catch {
    /* keep defaults */
  }
})
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur"
  >
    <div class="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
      <RouterLink to="/" class="flex items-center gap-1.5 font-bold text-lg shrink-0">
        <span :style="accentStyle">▲</span>
        <span>{{ settings.siteTitle }}</span>
      </RouterLink>

      <form class="flex-1 max-w-md" @submit.prevent="submitSearch">
        <input v-model="q" class="input py-1.5" :placeholder="t('search')" />
      </form>

      <div class="flex items-center gap-2 ml-auto">
        <button class="btn-ghost hidden sm:inline-flex" type="button" :title="t('commandPalette')" @click="openCommandPalette">
          Cmd K
        </button>
        <a
          v-for="link in settings.navLinks"
          :key="link.url + link.label"
          class="btn-ghost hidden lg:inline-flex"
          :href="link.url"
        >
          {{ link.label }}
        </a>
        <RouterLink to="/_events" class="btn-ghost">{{ t('events') }}</RouterLink>
        <RouterLink to="/_graph" class="btn-ghost">{{ t('graph') }}</RouterLink>
        <RouterLink v-if="auth.isAdmin" to="/_admin" class="btn-ghost">{{ t('admin') }}</RouterLink>
        <RouterLink v-if="auth.canEdit" to="/_new" class="btn-primary">{{ t('newPage') }}</RouterLink>
        <template v-if="auth.isAuthed">
          <span class="text-sm text-gray-500 hidden sm:inline">{{ auth.user?.name }}</span>
          <button class="btn-ghost" @click="auth.logout()">{{ t('signOut') }}</button>
        </template>
        <RouterLink v-else to="/_login" class="btn-ghost">{{ t('signIn') }}</RouterLink>
      </div>
    </div>
  </header>
</template>
