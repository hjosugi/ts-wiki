<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import AppFooter from '@/components/AppFooter.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import ShortcutsHelp from '@/components/ShortcutsHelp.vue'
import DrawerSheet from '@/components/DrawerSheet.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageTree from '@/components/PageTree.vue'
import DialogHost from '@/components/DialogHost.vue'
import ToastHost from '@/components/ToastHost.vue'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import { useI18n } from '@/lib/i18n'

const auth = useAuth()
const pages = usePages()
const route = useRoute()
const shelllessLayout = computed(() => route.name === 'shared' || route.name === 'setup')
const mobileNavOpen = ref(false)
const mainEl = ref<HTMLElement | null>(null)
const { t } = useI18n()

const refreshPagesForWikiLayout = (): void => {
  if (!shelllessLayout.value) void pages.refresh()
}

const openMobileNavigation = (): void => {
  mobileNavOpen.value = true
}

onMounted(() => {
  refreshPagesForWikiLayout()
  window.addEventListener('open-mobile-navigation', openMobileNavigation)
})
onBeforeUnmount(() => {
  window.removeEventListener('open-mobile-navigation', openMobileNavigation)
})
watch(shelllessLayout, refreshPagesForWikiLayout)
watch(() => route.fullPath, () => {
  mobileNavOpen.value = false
})
watch(() => route.path, async () => {
  await nextTick()
  mainEl.value?.focus({ preventScroll: true })
})
</script>

<template>
  <div class="flex min-h-screen min-w-0 max-w-full flex-col overflow-x-clip">
    <a
      v-if="!shelllessLayout"
      href="#main"
      class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-[var(--radius)] focus:bg-[var(--c-accent)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
    >
      {{ t('skipToContent') }}
    </a>
    <AppHeader v-if="!shelllessLayout" />
    <DrawerSheet v-if="!shelllessLayout" v-model:open="mobileNavOpen" :title="t('pages')">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div class="text-xs uppercase tracking-wide text-[var(--c-text-muted)] font-semibold">{{ t('pages') }}</div>
        <RouterLink v-if="auth.canEdit" to="/_new" class="text-xs link-quiet">{{ t('new') }}</RouterLink>
      </div>
      <PageTree v-if="pages.list.length" :pages="pages.list" />
      <EmptyState
        v-else
        :title="t('noPagesYet')"
        :message="t('createFirstPage')"
      >
        <template #actions>
          <RouterLink v-if="auth.canEdit" to="/_new" class="btn-primary">{{ t('newPage') }}</RouterLink>
          <RouterLink v-else to="/_login" class="btn-ghost">{{ t('signIn') }}</RouterLink>
        </template>
      </EmptyState>
    </DrawerSheet>
    <CommandPalette v-if="!shelllessLayout" />
    <ShortcutsHelp v-if="!shelllessLayout" />
    <DialogHost />
    <ToastHost />
    <div
      class="flex min-w-0 w-full flex-1"
      :class="shelllessLayout ? '' : 'max-w-7xl mx-auto px-4 gap-6'"
    >
      <aside v-if="!shelllessLayout" class="app-sidebar hidden md:block w-60 shrink-0 py-6">
        <div class="flex items-center justify-between gap-2 mb-2 px-2">
          <div class="text-xs uppercase tracking-wide text-[var(--c-text-muted)] font-semibold">{{ t('pages') }}</div>
          <RouterLink v-if="auth.canEdit" to="/_new" class="text-xs link-quiet">{{ t('new') }}</RouterLink>
        </div>
        <PageTree v-if="pages.list.length" :pages="pages.list" />
        <EmptyState
          v-else
          :title="t('noPagesYet')"
          :message="t('createFirstPage')"
        >
          <template #actions>
            <RouterLink v-if="auth.canEdit" to="/_new" class="btn-primary">{{ t('newPage') }}</RouterLink>
            <RouterLink v-else to="/_login" class="btn-ghost">{{ t('signIn') }}</RouterLink>
          </template>
        </EmptyState>
      </aside>

      <main id="main" ref="mainEl" class="flex-1 min-w-0" :class="shelllessLayout ? '' : 'py-6'" tabindex="-1">
        <RouterView />
      </main>
    </div>
    <AppFooter v-if="!shelllessLayout" />
  </div>
</template>
