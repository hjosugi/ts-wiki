<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { normalizePath } from '@ts-wiki/core'
import { Api, type SearchHit } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'

interface CommandItem {
  readonly key: string
  readonly label: string
  readonly detail: string
  readonly run: () => void
}

const router = useRouter()
const auth = useAuth()
const pages = usePages()
const open = ref(false)
const q = ref('')
const input = ref<HTMLInputElement | null>(null)
const selected = ref(0)
const hits = ref<SearchHit[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null

const localPages = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return pages.list.slice(0, 8)
  return pages.list
    .filter((page) => `${page.title} ${page.path}`.toLowerCase().includes(needle))
    .slice(0, 8)
})

const items = computed<CommandItem[]>(() => {
  const out: CommandItem[] = []
  const seen = new Set<string>()
  const pushPage = (path: string, title: string, detail: string): void => {
    if (seen.has(path)) return
    seen.add(path)
    out.push({
      key: `page:${path}`,
      label: title,
      detail,
      run: () => router.push('/' + path),
    })
  }

  for (const hit of hits.value) pushPage(hit.path, hit.title, `/${hit.path}`)
  for (const page of localPages.value) pushPage(page.path, page.title, `/${page.path}`)

  const normalized = normalizePath(q.value)
  if (auth.canEdit && normalized && !pages.list.some((page) => page.path === normalized)) {
    out.push({
      key: `create:${normalized}`,
      label: `Create "${normalized}"`,
      detail: 'New page',
      run: () => router.push({ name: 'new', query: { path: normalized } }),
    })
  }

  out.push({
    key: 'events',
    label: 'Events',
    detail: 'Calendar index',
    run: () => router.push('/_events'),
  })
  out.push({
    key: 'graph',
    label: 'Graph',
    detail: 'Open map',
    run: () => router.push('/_graph'),
  })
  if (auth.canEdit) {
    out.push({
      key: 'new',
      label: 'New page',
      detail: 'Blank draft',
      run: () => router.push('/_new'),
    })
  }
  return out
})

async function openPalette(): Promise<void> {
  open.value = true
  selected.value = 0
  if (!pages.list.length) await pages.refresh()
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function close(): void {
  open.value = false
  q.value = ''
  hits.value = []
}

function runSelected(): void {
  const item = items.value[selected.value]
  if (!item) return
  item.run()
  close()
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    void openPalette()
    return
  }
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    selected.value = Math.min(selected.value + 1, Math.max(items.value.length - 1, 0))
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selected.value = Math.max(selected.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    runSelected()
  }
}

watch(q, (value) => {
  selected.value = 0
  if (searchTimer) clearTimeout(searchTimer)
  const query = value.trim()
  if (!query) {
    hits.value = []
    return
  }
  searchTimer = setTimeout(() => {
    void Api.search(query, 8)
      .then((result) => {
        hits.value = result.hits
      })
      .catch(() => {
        hits.value = []
      })
  }, 120)
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('open-command-palette', openPalette)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('open-command-palette', openPalette)
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-[12vh]"
    @click.self="close"
  >
    <section class="card w-full max-w-2xl overflow-hidden">
      <input
        ref="input"
        v-model="q"
        class="w-full border-0 border-b border-gray-200 dark:border-gray-800 bg-transparent px-4 py-3 text-lg outline-none"
        placeholder="Search or jump..."
      />
      <div class="max-h-[24rem] overflow-auto p-2">
        <button
          v-for="(item, index) in items"
          :key="item.key"
          class="w-full rounded-md px-3 py-2 text-left flex items-center justify-between gap-4"
          :class="index === selected ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800'"
          type="button"
          @mouseenter="selected = index"
          @click="item.run(); close()"
        >
          <span class="min-w-0">
            <span class="block font-medium truncate">{{ item.label }}</span>
            <span class="block text-xs text-gray-500 truncate">{{ item.detail }}</span>
          </span>
          <span v-if="index === selected" class="text-xs text-gray-400">Enter</span>
        </button>
      </div>
    </section>
  </div>
</template>
