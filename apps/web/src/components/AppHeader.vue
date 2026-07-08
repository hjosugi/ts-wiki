<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { defaultPublicSettings } from '@ts-wiki/core'
import { Api, type PublicSettings } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { setDateFormatSettings, useI18n } from '@/lib/i18n'
import { useTheme, applySiteDefault } from '@/composables/useTheme'
import { applyBranding } from '@/lib/branding'
import { setMarkdownFeatureSettings } from '@/lib/markdownEnhance'

const router = useRouter()
const auth = useAuth()
const { t } = useI18n()
const theme = useTheme()
const themeIcon = computed(() => (theme.mode.value === 'light' ? '☀' : theme.mode.value === 'dark' ? '🌙' : '🖥'))
const q = ref('')
const settings = ref<PublicSettings>(defaultPublicSettings())
const accentStyle = computed(() => ({ color: settings.value.accentColor }))
const homeTo = computed(() => `/${settings.value.homePath || 'home'}`)
const builtInNav = computed(() => {
  const definitions = {
    changes: { to: '/_changes', label: t('changes'), show: true },
    events: { to: '/_events', label: t('events'), show: true },
    graph: { to: '/_graph', label: t('graph'), show: true },
    redirects: { to: '/_redirects', label: t('redirects'), show: auth.canEdit },
    templates: { to: '/_templates', label: 'Templates', show: auth.canEdit },
    new: { to: '/_new', label: t('newPage'), show: auth.canEdit },
  }
  return settings.value.navItems
    .filter((item) => item.visible)
    .map((item) => ({ key: item.key, ...definitions[item.key] }))
    .filter((item) => item.show)
})

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
    applyBranding(settings.value)
    setMarkdownFeatureSettings(settings.value)
    setDateFormatSettings(settings.value)
    applySiteDefault(settings.value.theme)
  } catch {
    /* keep defaults */
  }
})
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-[var(--c-border)] bg-[var(--c-surface)]/90 backdrop-blur"
  >
    <div class="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
      <RouterLink :to="homeTo" class="flex items-center gap-1.5 font-bold text-lg shrink-0">
        <img v-if="settings.logoUrl" :src="settings.logoUrl" alt="" class="h-7 w-7 rounded object-cover" />
        <span v-else :style="accentStyle">▲</span>
        <span>{{ settings.siteTitle }}</span>
      </RouterLink>

      <form class="flex-1 max-w-md" @submit.prevent="submitSearch">
        <input v-model="q" class="input py-1.5" :placeholder="t('search')" />
      </form>

      <div class="flex items-center gap-2 ml-auto">
        <button class="btn-ghost hidden sm:inline-flex" type="button" :title="t('commandPalette')" @click="openCommandPalette">
          Cmd K
        </button>
        <button
          class="btn-ghost"
          type="button"
          :title="`Theme: ${theme.mode.value}`"
          :aria-label="`Theme: ${theme.mode.value}. Click to change.`"
          @click="theme.cycle()"
        >
          {{ themeIcon }}
        </button>
        <div class="hidden items-center gap-2 lg:flex">
          <template v-for="link in settings.navLinks" :key="link.url + link.label">
            <details v-if="link.children.length" class="relative">
              <summary class="btn-ghost cursor-pointer list-none">
                <span v-if="link.icon">{{ link.icon }}</span>{{ link.label }}
              </summary>
              <div class="absolute right-0 mt-2 min-w-44 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-1 shadow-lg">
                <a
                  v-for="child in link.children"
                  :key="child.url + child.label"
                  class="block rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]"
                  :href="child.url"
                >
                  <span v-if="child.icon">{{ child.icon }} </span>{{ child.label }}
                </a>
              </div>
            </details>
            <a v-else class="btn-ghost" :href="link.url">
              <span v-if="link.icon">{{ link.icon }} </span>{{ link.label }}
            </a>
          </template>
          <RouterLink
            v-for="item in builtInNav"
            :key="item.key"
            :to="item.to"
            :class="item.key === 'new' ? 'btn-primary' : 'btn-ghost'"
          >
            {{ item.label }}
          </RouterLink>
        </div>
        <RouterLink v-if="auth.isAdmin" to="/_admin" class="btn-ghost">{{ t('admin') }}</RouterLink>
        <details class="relative lg:hidden">
          <summary class="btn-ghost cursor-pointer list-none">Menu</summary>
          <div class="absolute right-0 mt-2 flex min-w-52 flex-col rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-1 shadow-lg">
            <template v-for="link in settings.navLinks" :key="'mobile:' + link.url + link.label">
              <a v-if="!link.children.length" class="rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]" :href="link.url">
                <span v-if="link.icon">{{ link.icon }} </span>{{ link.label }}
              </a>
              <div v-else class="px-3 py-2 text-sm">
                <div class="font-medium"><span v-if="link.icon">{{ link.icon }} </span>{{ link.label }}</div>
                <a
                  v-for="child in link.children"
                  :key="'mobile-child:' + child.url + child.label"
                  class="mt-1 block rounded px-2 py-1 text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)]"
                  :href="child.url"
                >
                  <span v-if="child.icon">{{ child.icon }} </span>{{ child.label }}
                </a>
              </div>
            </template>
            <RouterLink
              v-for="item in builtInNav"
              :key="'mobile:' + item.key"
              :to="item.to"
              class="rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]"
            >
              {{ item.label }}
            </RouterLink>
          </div>
        </details>
        <template v-if="auth.isAuthed">
          <span class="hidden text-sm text-[var(--c-text-muted)] sm:inline">{{ auth.user?.name }}</span>
          <button class="btn-ghost" @click="auth.logout()">{{ t('signOut') }}</button>
        </template>
        <RouterLink v-else to="/_login" class="btn-ghost">{{ t('signIn') }}</RouterLink>
      </div>
    </div>
  </header>
</template>
