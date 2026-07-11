<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { defaultPublicSettings } from '@kawaii-wiki/core'
import { Api, type PublicSettings } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { setDateFormatSettings, useI18n } from '@/lib/i18n'
import { useTheme, applySiteDefault } from '@/composables/useTheme'
import { applyBranding } from '@/lib/branding'
import { setMarkdownFeatureSettings } from '@/lib/markdownEnhance'
import { shortcutLabel } from '@/lib/platform'
import { realtimeStatus } from '@/lib/realtime'
import NotificationBell from '@/components/NotificationBell.vue'

const router = useRouter()
const auth = useAuth()
const { t, locale, setLocale } = useI18n()
const theme = useTheme()
const themeIcon = computed(() => (theme.mode.value === 'light' ? '☀' : theme.mode.value === 'dark' ? '🌙' : '🖥'))
const q = ref('')
const settings = ref<PublicSettings>(defaultPublicSettings())
const headerEl = ref<HTMLElement | null>(null)
const accentStyle = computed(() => ({ color: settings.value.accentColor }))
const homeTo = computed(() => `/${settings.value.homePath || 'home'}`)
const commandShortcut = shortcutLabel('K')
const realtimeLabel = computed(() => ({
  connected: t('liveConnected'),
  connecting: t('liveConnecting'),
  reconnecting: t('liveReconnecting'),
  offline: t('liveOffline'),
}[realtimeStatus.value]))
const builtInNav = computed(() => {
  const definitions = {
    changes: { to: '/_changes', label: t('changes'), show: true },
    events: { to: '/_events', label: t('events'), show: true },
    graph: { to: '/_graph', label: t('graph'), show: true },
    redirects: { to: '/_redirects', label: t('redirects'), show: auth.canEdit },
    templates: { to: '/_templates', label: t('templates'), show: auth.canEdit },
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

function openMobileNavigation(): void {
  window.dispatchEvent(new Event('open-mobile-navigation'))
}

const closeMenus = (): void => {
  headerEl.value?.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'))
}

const closeMenusOutside = (event: PointerEvent): void => {
  const target = event.target as Node | null
  headerEl.value?.querySelectorAll('details[open]').forEach((menu) => {
    if (!target || !menu.contains(target)) menu.removeAttribute('open')
  })
}

const closeMenusOnEscape = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') closeMenus()
}

let removeRouteHook: (() => void) | null = null

onMounted(() => {
  document.addEventListener('pointerdown', closeMenusOutside)
  document.addEventListener('keydown', closeMenusOnEscape)
  removeRouteHook = router.afterEach(closeMenus)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeMenusOutside)
  document.removeEventListener('keydown', closeMenusOnEscape)
  removeRouteHook?.()
})

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
    ref="headerEl"
    class="app-shell-header sticky top-0 z-10 border-b border-[var(--c-border)] bg-[var(--c-surface)]/90 backdrop-blur"
  >
    <div class="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4">
      <button
        class="btn-ghost h-9 w-9 shrink-0 px-0 md:hidden"
        type="button"
        :aria-label="t('openNavigation')"
        :title="t('openNavigation')"
        @click="openMobileNavigation"
      >
        ☰
      </button>

      <RouterLink :to="homeTo" class="flex min-w-0 shrink-0 items-center gap-1.5 text-lg font-bold">
        <img v-if="settings.logoUrl" :src="settings.logoUrl" alt="" class="h-7 w-7 rounded object-cover" />
        <span v-else :style="accentStyle">▲</span>
        <span class="hidden max-w-[10rem] truncate sm:inline">{{ settings.siteTitle }}</span>
      </RouterLink>

      <form class="min-w-0 flex-1 max-w-md" @submit.prevent="submitSearch">
        <input v-model="q" class="input w-full py-1.5 text-sm sm:text-base" :placeholder="t('search')" :aria-label="t('search')" />
      </form>

      <div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <span
          class="hidden items-center gap-1.5 text-xs text-[var(--c-text-muted)] xl:inline-flex"
          :title="realtimeLabel"
          role="status"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="realtimeStatus === 'connected' ? 'bg-emerald-500' : realtimeStatus === 'offline' ? 'bg-gray-400' : 'bg-amber-500 animate-pulse'"
            aria-hidden="true"
          ></span>
          {{ realtimeStatus === 'connected' ? 'Live' : realtimeStatus === 'offline' ? 'Offline' : 'Syncing' }}
        </span>
        <select
          class="input hidden w-auto py-1 text-xs sm:block"
          :value="locale"
          :aria-label="t('locale')"
          @change="setLocale(($event.target as HTMLSelectElement).value === 'ja' ? 'ja' : 'en')"
        >
          <option value="en">EN</option>
          <option value="ja">日本語</option>
        </select>
        <NotificationBell v-if="auth.isAuthed" />
        <button
          class="btn-ghost h-9 w-9 px-0 sm:w-auto sm:px-3"
          type="button"
          :title="t('commandPalette')"
          :aria-label="t('commandPalette')"
          @click="openCommandPalette"
        >
          <span class="sm:hidden" aria-hidden="true">⌕</span>
          <span class="hidden sm:inline">{{ commandShortcut }}</span>
        </button>
        <button
          class="btn-ghost hidden sm:inline-flex"
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
        <RouterLink v-if="auth.isAdmin" to="/_admin" class="btn-ghost hidden md:inline-flex">{{ t('admin') }}</RouterLink>
        <details class="relative lg:hidden">
          <summary
            class="btn-ghost flex h-9 w-9 cursor-pointer list-none items-center justify-center px-0 md:w-auto md:px-3"
            :aria-label="t('openMenu')"
            :title="t('openMenu')"
          >
            <span class="md:hidden" aria-hidden="true">⋯</span>
            <span class="hidden md:inline">{{ t('menu') }}</span>
          </summary>
          <div class="absolute right-0 mt-2 flex min-w-52 flex-col rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-1 shadow-lg">
            <div class="flex items-center gap-2 border-b border-[var(--c-border)] px-3 py-2 sm:hidden">
              <select
                class="input min-w-0 flex-1 py-1 text-xs"
                :value="locale"
                :aria-label="t('locale')"
                @change="setLocale(($event.target as HTMLSelectElement).value === 'ja' ? 'ja' : 'en')"
              >
                <option value="en">EN</option>
                <option value="ja">日本語</option>
              </select>
              <button
                class="btn-ghost h-8 px-2"
                type="button"
                :title="`Theme: ${theme.mode.value}`"
                :aria-label="`Theme: ${theme.mode.value}. Click to change.`"
                @click="theme.cycle()"
              >
                {{ themeIcon }}
              </button>
            </div>
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
            <RouterLink
              v-if="auth.isAdmin"
              to="/_admin"
              class="rounded px-3 py-2 text-sm hover:bg-[var(--c-surface-muted)]"
            >
              {{ t('admin') }}
            </RouterLink>
            <button
              v-if="auth.isAuthed"
              class="rounded px-3 py-2 text-left text-sm hover:bg-[var(--c-surface-muted)]"
              type="button"
              @click="auth.logout()"
            >
              {{ t('signOut') }}
            </button>
          </div>
        </details>
        <template v-if="auth.isAuthed">
          <span class="hidden text-sm text-[var(--c-text-muted)] sm:inline">{{ auth.user?.name }}</span>
          <button class="btn-ghost hidden sm:inline-flex" @click="auth.logout()">{{ t('signOut') }}</button>
        </template>
        <RouterLink v-else to="/_login" class="btn-ghost shrink-0">{{ t('signIn') }}</RouterLink>
      </div>
    </div>
  </header>
</template>
