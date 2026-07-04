<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'

const router = useRouter()
const auth = useAuth()
const q = ref('')

function submitSearch(): void {
  const query = q.value.trim()
  if (query) router.push({ name: 'search', query: { q: query } })
}
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur"
  >
    <div class="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
      <RouterLink to="/" class="flex items-center gap-1.5 font-bold text-lg shrink-0">
        <span class="text-violet-600">▲</span> ts<span class="text-violet-600">wiki</span>
      </RouterLink>

      <form class="flex-1 max-w-md" @submit.prevent="submitSearch">
        <input v-model="q" class="input py-1.5" placeholder="Search…  (try: banana)" />
      </form>

      <div class="flex items-center gap-2 ml-auto">
        <RouterLink to="/_graph" class="btn-ghost">Graph</RouterLink>
        <RouterLink v-if="auth.isAdmin" to="/_admin" class="btn-ghost">Admin</RouterLink>
        <RouterLink v-if="auth.canEdit" to="/_new" class="btn-primary">+ New page</RouterLink>
        <template v-if="auth.isAuthed">
          <span class="text-sm text-gray-500 hidden sm:inline">{{ auth.user?.name }}</span>
          <button class="btn-ghost" @click="auth.logout()">Sign out</button>
        </template>
        <RouterLink v-else to="/_login" class="btn-ghost">Sign in</RouterLink>
      </div>
    </div>
  </header>
</template>
