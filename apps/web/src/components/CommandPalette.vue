<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { normalizePath } from '@ts-wiki/core'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import { useListNavigation, useSearch } from '@/composables/useSearch'
import { Api } from '@/lib/api'
import ModalDialog from '@/components/ModalDialog.vue'

interface CommandItem {
  readonly key: string
  readonly icon?: string
  readonly label: string
  readonly detail: string
  readonly run: () => void
}

const router = useRouter()
const auth = useAuth()
const pages = usePages()
const open = ref(false)
const input = ref<HTMLInputElement | null>(null)
const search = useSearch({ limit: 8, debounceMs: 120, scope: 'title' })
const dailyNotesPath = ref('journal')
const dailyNotesTimeZone = ref(browserTimeZone())
const commandSettingsLoaded = ref(false)

const localPages = computed(() => {
  const needle = search.q.value.trim().toLowerCase()
  if (!needle) return pages.list.slice(0, 8)
  return pages.list
    .filter((page) => `${page.title} ${page.path}`.toLowerCase().includes(needle))
    .slice(0, 8)
})
const pageByPath = computed(() => new Map(pages.list.map((page) => [page.path, page])))
const todayIso = computed(() => isoDateInTimeZone(dailyNotesTimeZone.value))
const todayNotePath = computed(() => normalizePath(`${dailyNotesPath.value}/${todayIso.value}`) || `journal/${todayIso.value}`)
const todayNoteTitle = computed(() => `Daily note ${todayIso.value}`)

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function isoDateInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '01'
  return `${value('year')}-${value('month')}-${value('day')}`
}

async function loadCommandSettings(): Promise<void> {
  if (commandSettingsLoaded.value) return
  try {
    const settings = await Api.publicSettings()
    dailyNotesPath.value = normalizePath(settings.dailyNotesPath) || 'journal'
    dailyNotesTimeZone.value = settings.timezone || browserTimeZone()
  } catch {
    dailyNotesPath.value = 'journal'
    dailyNotesTimeZone.value = browserTimeZone()
  } finally {
    commandSettingsLoaded.value = true
  }
}

const items = computed<CommandItem[]>(() => {
  const out: CommandItem[] = []
  const seen = new Set<string>()
  const pushPage = (path: string, title: string, detail: string, icon = ''): void => {
    if (seen.has(path)) return
    seen.add(path)
    out.push({
      key: `page:${path}`,
      icon,
      label: title,
      detail,
      run: () => router.push('/' + path),
    })
  }

  for (const hit of search.hits.value) pushPage(hit.path, hit.title, `/${hit.path}`, pageByPath.value.get(hit.path)?.icon ?? '')
  for (const page of localPages.value) pushPage(page.path, page.title, `/${page.path}`, page.icon)

  const normalized = normalizePath(search.q.value)
  if (auth.canEdit && normalized && !pages.list.some((page) => page.path === normalized)) {
    out.push({
      key: `create:${normalized}`,
      label: `Create "${normalized}"`,
      detail: 'New page',
      run: () => router.push({ name: 'new', query: { path: normalized } }),
    })
  }

  const todayPage = pageByPath.value.get(todayNotePath.value)
  if (todayPage || auth.canEdit) {
    out.push({
      key: 'today-note',
      icon: todayPage?.icon || '🗓️',
      label: "Today's note",
      detail: todayPage ? `/${todayPage.path}` : `Create /${todayNotePath.value}`,
      run: () => {
        if (todayPage) router.push('/' + todayPage.path)
        else router.push({
          name: 'new',
          query: {
            path: todayNotePath.value,
            template: 'builtin:journal',
            title: todayNoteTitle.value,
          },
        })
      },
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
  out.push({
    key: 'tags',
    label: 'Tags',
    detail: 'Browse by label',
    run: () => router.push('/_tags'),
  })
  out.push({
    key: 'changes',
    label: 'Recent changes',
    detail: 'Activity feed',
    run: () => router.push('/_changes'),
  })
  out.push({
    key: 'shortcuts',
    label: 'Keyboard shortcuts',
    detail: 'Show help',
    run: () => window.dispatchEvent(new Event('open-shortcuts-help')),
  })
  out.push({
    key: 'links',
    label: 'Broken links',
    detail: 'Find missing pages',
    run: () => router.push('/_links'),
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
  navigation.reset()
  await Promise.all([
    pages.list.length ? Promise.resolve() : pages.refresh(),
    loadCommandSettings(),
  ])
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function close(): void {
  open.value = false
  search.q.value = ''
  search.clear()
}

function runSelected(): void {
  const item = items.value[navigation.selected.value]
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
  } else {
    navigation.onKeydown(event)
  }
}

const navigation = useListNavigation(computed(() => items.value.length), runSelected)

watch(() => search.q.value, (value) => {
  navigation.reset()
  const query = value.trim()
  if (!query) {
    search.clear()
    return
  }
  search.schedule()
})

function chooseRecent(query: string): void {
  search.q.value = query
  search.schedule()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('open-command-palette', openPalette)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('open-command-palette', openPalette)
})
</script>

<template>
  <ModalDialog
    :open="open"
    title="Command palette"
    container-class="items-start justify-center p-4 pt-[12vh]"
    panel-class="card w-full max-w-2xl overflow-hidden p-0"
    @close="close"
  >
    <input
      ref="input"
      v-model="search.q.value"
      class="w-full border-0 border-b border-gray-200 dark:border-gray-800 bg-transparent px-4 py-3 text-lg outline-none"
      placeholder="Search or jump..."
      aria-label="Search or jump"
      role="combobox"
      aria-controls="command-palette-results"
      :aria-expanded="Boolean(items.length)"
      :aria-activedescendant="navigation.activeId('command-palette-item')"
    />
    <div v-if="!search.q.value.trim() && search.recentSearches.value.length" class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
      <div class="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Recent</div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="recent in search.recentSearches.value"
          :key="recent"
          class="rounded-full border border-gray-200 px-3 py-1 text-sm hover:border-violet-400 dark:border-gray-800"
          type="button"
          @click="chooseRecent(recent)"
        >
          {{ recent }}
        </button>
      </div>
    </div>
    <div id="command-palette-results" class="max-h-[24rem] overflow-auto p-2" role="listbox">
      <button
        v-for="(item, index) in items"
        :id="`command-palette-item-${index}`"
        :key="item.key"
        class="w-full rounded-md px-3 py-2 text-left flex items-center justify-between gap-4"
        :class="index === navigation.selected.value ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800'"
        type="button"
        role="option"
        :aria-selected="index === navigation.selected.value"
        @mouseenter="navigation.selected.value = index"
        @click="item.run(); close()"
      >
        <span v-if="item.icon" class="shrink-0 text-lg" aria-hidden="true">{{ item.icon }}</span>
        <span class="min-w-0 flex-1">
          <span class="block font-medium truncate">{{ item.label }}</span>
          <span class="block text-xs text-gray-500 truncate">{{ item.detail }}</span>
        </span>
        <span v-if="index === navigation.selected.value" class="text-xs text-[var(--c-text-muted)]">Enter</span>
      </button>
    </div>
  </ModalDialog>
</template>
