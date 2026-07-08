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
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'

const auth = useAuth()
const pages = usePages()
const route = useRoute()
const sharedLayout = computed(() => route.name === 'shared')
const mobileNavOpen = ref(false)
const mainEl = ref<HTMLElement | null>(null)

const refreshPagesForWikiLayout = (): void => {
  if (!sharedLayout.value) void pages.refresh()
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
watch(sharedLayout, refreshPagesForWikiLayout)
watch(() => route.fullPath, async () => {
  mobileNavOpen.value = false
  await nextTick()
  mainEl.value?.focus({ preventScroll: true })
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <a
      v-if="!sharedLayout"
      href="#main"
      class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-[var(--radius)] focus:bg-[var(--c-accent)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
    >
      Skip to content
    </a>
    <AppHeader v-if="!sharedLayout" />
    <DrawerSheet v-if="!sharedLayout" v-model:open="mobileNavOpen" title="Pages">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div class="text-xs uppercase tracking-wide text-gray-400 font-semibold">Pages</div>
        <RouterLink v-if="auth.canEdit" to="/_new" class="text-xs link-quiet">New</RouterLink>
      </div>
      <PageTree v-if="pages.list.length" :pages="pages.list" />
      <EmptyState
        v-else
        title="No pages yet"
        message="Create the first page to start shaping the wiki."
      >
        <template #actions>
          <RouterLink v-if="auth.canEdit" to="/_new" class="btn-primary">New page</RouterLink>
          <RouterLink v-else to="/_login" class="btn-ghost">Sign in</RouterLink>
        </template>
      </EmptyState>
    </DrawerSheet>
    <CommandPalette v-if="!sharedLayout" />
    <ShortcutsHelp v-if="!sharedLayout" />
    <div
      class="flex-1 w-full flex"
      :class="sharedLayout ? '' : 'max-w-7xl mx-auto px-4 gap-6'"
    >
      <aside v-if="!sharedLayout" class="hidden md:block w-60 shrink-0 py-6">
        <div class="flex items-center justify-between gap-2 mb-2 px-2">
          <div class="text-xs uppercase tracking-wide text-gray-400 font-semibold">Pages</div>
          <RouterLink v-if="auth.canEdit" to="/_new" class="text-xs link-quiet">New</RouterLink>
        </div>
        <PageTree v-if="pages.list.length" :pages="pages.list" />
        <EmptyState
          v-else
          title="No pages yet"
          message="Create the first page to start shaping the wiki."
        >
          <template #actions>
            <RouterLink v-if="auth.canEdit" to="/_new" class="btn-primary">New page</RouterLink>
            <RouterLink v-else to="/_login" class="btn-ghost">Sign in</RouterLink>
          </template>
        </EmptyState>
      </aside>

      <main id="main" ref="mainEl" class="flex-1 min-w-0" :class="sharedLayout ? '' : 'py-6'" tabindex="-1">
        <RouterView />
      </main>
    </div>
    <AppFooter v-if="!sharedLayout" />
  </div>
</template>
