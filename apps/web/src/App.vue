<script setup lang="ts">
import { onMounted } from 'vue'
import AppHeader from '@/components/AppHeader.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageTree from '@/components/PageTree.vue'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'

const auth = useAuth()
const pages = usePages()
onMounted(() => pages.refresh())
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <AppHeader />
    <CommandPalette />
    <div class="flex-1 w-full max-w-7xl mx-auto px-4 flex gap-6">
      <aside class="hidden md:block w-60 shrink-0 py-6">
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

      <main class="flex-1 min-w-0 py-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
