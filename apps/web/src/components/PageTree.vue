<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { normalizePath } from '@kawaii-wiki/core'
import { Api, type PageSummary, type UserPreferenceKey, type UserPreferenceMap } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'
import { readMigratedStorage } from '@/lib/storage'
import { useDialogs } from '@/composables/useDialogs'
import { useI18n } from '@/lib/i18n'

interface TreeNode {
  key: string
  label: string
  path: string
  page?: PageSummary
  children: Map<string, TreeNode>
}

interface TreeRow {
  key: string
  label: string
  path: string
  icon: string
  depth: number
  isPage: boolean
  hasChildren: boolean
  collapsed: boolean
}

const props = defineProps<{
  pages: PageSummary[]
}>()

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const pagesStore = usePages()
const dialogs = useDialogs()
const { t } = useI18n()

const COLLAPSED_STORAGE_KEY = 'kawaii-wiki.ts:collapsed-folders'
const STARRED_STORAGE_KEY = 'kawaii-wiki.ts:starred-pages'
const RECENT_STORAGE_KEY = 'kawaii-wiki.ts:recent-pages'
const ORDER_STORAGE_KEY = 'kawaii-wiki.ts:page-order'
const legacyStorageKey = (key: string): string => key.replace('kawaii-wiki.ts:', 'ts-wiki:')
const COLLAPSED_PREFERENCE_KEY: UserPreferenceKey = 'nav:collapsed'
const STARRED_PREFERENCE_KEY: UserPreferenceKey = 'nav:starred'
const ORDER_PREFERENCE_KEY: UserPreferenceKey = 'nav:page-order'

const readStringList = (key: string): string[] => {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(readMigratedStorage(key, [legacyStorageKey(key)]) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const readOrder = (): Record<string, number> => {
  if (typeof window === 'undefined') return {}
  try {
    const value = JSON.parse(readMigratedStorage(ORDER_STORAGE_KEY, [legacyStorageKey(ORDER_STORAGE_KEY)]) ?? '{}')
    return coerceOrder(value) ?? {}
  } catch {
    return {}
  }
}

const coerceOrder = (value: unknown): Record<string, number> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  const out: Record<string, number> = {}
  for (const [path, order] of entries) {
    if (typeof order !== 'number' || !Number.isFinite(order)) return null
    out[path] = Math.trunc(order)
  }
  return out
}

const coerceStringList = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null

const hasPreference = (preferences: UserPreferenceMap, key: UserPreferenceKey): boolean =>
  Object.prototype.hasOwnProperty.call(preferences, key)

const collapsed = ref(readStringList(COLLAPSED_STORAGE_KEY))
const starred = ref(readStringList(STARRED_STORAGE_KEY))
const recent = ref(readStringList(RECENT_STORAGE_KEY))
const manualOrder = ref(readOrder())
const draggingPath = ref<string | null>(null)
const moveSourcePath = ref('')
const moveDestinationFolder = ref('')
const moving = ref(false)
const moveError = ref<string | null>(null)
const moveNotice = ref<string | null>(null)

const persist = (key: string, value: unknown): void => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

const persistPreference = (key: UserPreferenceKey, value: unknown): void => {
  if (!auth.isAuthed) return
  void Api.updatePreferences({ [key]: value } as UserPreferenceMap).catch(() => {})
}

const loadServerPreferences = async (): Promise<void> => {
  if (!auth.isAuthed) return
  try {
    const preferences = await Api.preferences()
    if (hasPreference(preferences, COLLAPSED_PREFERENCE_KEY)) {
      const value = coerceStringList(preferences[COLLAPSED_PREFERENCE_KEY])
      if (value) {
        collapsed.value = value
        persist(COLLAPSED_STORAGE_KEY, value)
      }
    }
    if (hasPreference(preferences, STARRED_PREFERENCE_KEY)) {
      const value = coerceStringList(preferences[STARRED_PREFERENCE_KEY])
      if (value) {
        starred.value = value
        persist(STARRED_STORAGE_KEY, value)
      }
    }
    if (hasPreference(preferences, ORDER_PREFERENCE_KEY)) {
      const value = coerceOrder(preferences[ORDER_PREFERENCE_KEY])
      if (value) {
        manualOrder.value = value
        persist(ORDER_STORAGE_KEY, value)
      }
    }
  } catch {
    // Keep localStorage as the offline/source-of-last-resort state.
  }
}

const pageByPath = computed(() => new Map(props.pages.map((page) => [page.path, page])))
const starredPages = computed(() => starred.value.map((path) => pageByPath.value.get(path)).filter(Boolean) as PageSummary[])
const recentPages = computed(() => recent.value.map((path) => pageByPath.value.get(path)).filter(Boolean) as PageSummary[])
const currentPath = computed(() => paramToPath(route.params.path))
const isCollapsed = (path: string): boolean => collapsed.value.includes(path)
const isStarred = (path: string): boolean => starred.value.includes(path)

watch(
  currentPath,
  (path) => {
    if (!path || !pageByPath.value.has(path)) return
    recent.value = [path, ...recent.value.filter((item) => item !== path)].slice(0, 6)
    persist(RECENT_STORAGE_KEY, recent.value)
  },
  { immediate: true },
)

onMounted(() => {
  void loadServerPreferences()
})

watch(
  () => auth.isAuthed,
  (isAuthed) => {
    if (isAuthed) void loadServerPreferences()
  },
)

function toggleCollapse(path: string): void {
  collapsed.value = isCollapsed(path)
    ? collapsed.value.filter((item) => item !== path)
    : [...collapsed.value, path]
  persist(COLLAPSED_STORAGE_KEY, collapsed.value)
  persistPreference(COLLAPSED_PREFERENCE_KEY, collapsed.value)
}

function toggleStar(path: string): void {
  starred.value = isStarred(path)
    ? starred.value.filter((item) => item !== path)
    : [path, ...starred.value]
  persist(STARRED_STORAGE_KEY, starred.value)
  persistPreference(STARRED_PREFERENCE_KEY, starred.value)
}

function comparePages(a: PageSummary, b: PageSummary): number {
  const aManual = manualOrder.value[a.path]
  const bManual = manualOrder.value[b.path]
  if (aManual !== undefined || bManual !== undefined) {
    return (aManual ?? Number.MAX_SAFE_INTEGER) - (bManual ?? Number.MAX_SAFE_INTEGER) || a.path.localeCompare(b.path)
  }
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  const aOrder = a.navOrder ?? Number.MAX_SAFE_INTEGER
  const bOrder = b.navOrder ?? Number.MAX_SAFE_INTEGER
  return aOrder - bOrder || a.path.localeCompare(b.path)
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.page && b.page) return comparePages(a.page, b.page)
  if (a.page && !b.page) {
    if (a.page.pinned) return -1
    if (a.page.navOrder !== null) return -1
  }
  if (!a.page && b.page) {
    if (b.page.pinned) return 1
    if (b.page.navOrder !== null) return 1
  }
  return a.label.localeCompare(b.label)
}

function movePersonalOrder(path: string, delta: -1 | 1): void {
  const ordered = [...props.pages].sort(comparePages)
  const index = ordered.findIndex((page) => page.path === path)
  const next = index + delta
  if (index < 0 || next < 0 || next >= ordered.length) return
  const [page] = ordered.splice(index, 1)
  if (!page) return
  ordered.splice(next, 0, page)
  manualOrder.value = Object.fromEntries(ordered.map((item, order) => [item.path, order]))
  persist(ORDER_STORAGE_KEY, manualOrder.value)
  persistPreference(ORDER_PREFERENCE_KEY, manualOrder.value)
}

const parentFolder = (path: string): string => path.split('/').slice(0, -1).join('/')
const basename = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path

function movedPath(sourcePath: string, destinationFolder: string): string {
  const folder = normalizePath(destinationFolder)
  const name = basename(sourcePath)
  return folder ? `${folder}/${name}` : name
}

function openMoveDialog(path: string): void {
  moveSourcePath.value = path
  moveDestinationFolder.value = parentFolder(path)
  moveError.value = null
  moveNotice.value = null
}

function closeMoveDialog(): void {
  if (moving.value) return
  moveSourcePath.value = ''
  moveDestinationFolder.value = ''
}

async function moveWikiPage(sourcePath: string, destinationFolder: string): Promise<void> {
  if (!auth.canEdit || moving.value) return
  const destination = movedPath(sourcePath, destinationFolder)
  if (!destination || destination === sourcePath) return
  if (destination.startsWith(`${sourcePath}/`)) {
    moveError.value = 'Move a page outside its own subtree.'
    return
  }
  const inbound = await Api.backlinks(sourcePath).catch(() => [])
  const warning = inbound.length
    ? `\n\n${inbound.length} inbound link${inbound.length === 1 ? '' : 's'} point to /${sourcePath}.`
    : ''
  if (!await dialogs.confirm({
    title: 'Move page',
    message: `Move /${sourcePath} to /${destination}? This changes the page URL.${warning}`,
  })) return
  moving.value = true
  moveError.value = null
  moveNotice.value = null
  try {
    const moved = await Api.movePage(sourcePath, destination)
    await pagesStore.refresh()
    moveNotice.value = `Moved to /${moved.path}`
    if (currentPath.value === sourcePath) await router.push('/' + moved.path)
    moveSourcePath.value = ''
    moveDestinationFolder.value = ''
  } catch (e) {
    moveError.value = friendlyError(e)
  } finally {
    moving.value = false
  }
}

function onDragStart(row: TreeRow, event: DragEvent): void {
  if (!auth.canEdit || !row.isPage) return
  draggingPath.value = row.path
  event.dataTransfer?.setData('text/plain', row.path)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDrop(row: TreeRow, event: DragEvent): void {
  const source = draggingPath.value || event.dataTransfer?.getData('text/plain')
  draggingPath.value = null
  if (!source || source === row.path) return
  void moveWikiPage(source, row.path)
}

const rows = computed<TreeRow[]>(() => {
  const root: TreeNode = { key: '', label: '', path: '', children: new Map() }

  for (const page of props.pages) {
    const segments = page.path.split('/').filter(Boolean)
    let current = root
    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join('/')
      let child = current.children.get(segment)
      if (!child) {
        child = { key: path, label: segment, path, children: new Map() }
        current.children.set(segment, child)
      }
      if (index === segments.length - 1) {
        child.page = page
        child.label = page.title
      }
      current = child
    })
  }

  const out: TreeRow[] = []
  const visit = (node: TreeNode, depth: number): void => {
    const children = [...node.children.values()].sort(compareNodes)
    for (const child of children) {
      out.push({
        key: child.key,
        label: child.label,
        path: child.path,
        icon: child.page?.icon ?? '',
        depth,
        isPage: Boolean(child.page),
        hasChildren: child.children.size > 0,
        collapsed: isCollapsed(child.path),
      })
      if (!isCollapsed(child.path)) visit(child, depth + 1)
    }
  }
  visit(root, 0)
  return out
})
</script>

<template>
  <nav class="flex flex-col gap-3">
    <section v-if="starredPages.length" class="space-y-1">
      <div class="px-2 text-[11px] uppercase tracking-wide text-[var(--c-text-muted)] font-semibold">{{ t('starred') }}</div>
      <RouterLink
        v-for="page in starredPages"
        :key="'starred:' + page.path"
        :to="'/' + page.path"
        class="page-tree-row"
        active-class="page-tree-row-active"
      >
        <span v-if="page.icon" aria-hidden="true">{{ page.icon }}</span>
        <span class="truncate">{{ page.title }}</span>
      </RouterLink>
    </section>

    <section v-if="recentPages.length" class="space-y-1">
      <div class="px-2 text-[11px] uppercase tracking-wide text-[var(--c-text-muted)] font-semibold">{{ t('recent') }}</div>
      <RouterLink
        v-for="page in recentPages"
        :key="'recent:' + page.path"
        :to="'/' + page.path"
        class="page-tree-row"
        active-class="page-tree-row-active"
      >
        <span v-if="page.icon" aria-hidden="true">{{ page.icon }}</span>
        <span class="truncate">{{ page.title }}</span>
      </RouterLink>
    </section>

    <section class="flex flex-col gap-0.5">
    <template v-for="row in rows" :key="row.key">
      <div
        class="page-tree-line group"
        :class="draggingPath && draggingPath !== row.path ? 'outline outline-1 outline-[var(--c-accent)]/40' : ''"
        :style="{ paddingLeft: 0.25 + row.depth * 0.75 + 'rem' }"
        :draggable="auth.canEdit && row.isPage"
        @dragstart="onDragStart(row, $event)"
        @dragend="draggingPath = null"
        @dragover.prevent
        @drop.prevent="onDrop(row, $event)"
      >
        <button
          v-if="row.hasChildren"
          class="page-tree-icon"
          type="button"
          :title="row.collapsed ? t('expandFolder') : t('collapseFolder')"
          :aria-label="`${row.collapsed ? 'Expand' : 'Collapse'} ${row.label}`"
          @click="toggleCollapse(row.path)"
        >
          {{ row.collapsed ? '▸' : '▾' }}
        </button>
        <span v-else class="page-tree-spacer"></span>
        <RouterLink
          v-if="row.isPage"
          :to="'/' + row.path"
          class="page-tree-row"
          active-class="page-tree-row-active"
        >
          <span v-if="row.icon" class="shrink-0" aria-hidden="true">{{ row.icon }}</span>
          {{ row.label }}
        </RouterLink>
        <span v-else class="page-tree-folder">
          {{ row.label }}
        </span>
        <span v-if="row.isPage" class="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            class="page-tree-icon"
            type="button"
            :title="t('starPage')"
            :aria-label="t('starPage')"
            @click="toggleStar(row.path)"
          >
            {{ isStarred(row.path) ? '★' : '☆' }}
          </button>
          <button class="page-tree-icon" type="button" :title="t('moveUpPersonal', { page: row.label })" :aria-label="t('moveUpPersonal', { page: row.label })" @click="movePersonalOrder(row.path, -1)">↑</button>
          <button class="page-tree-icon" type="button" :title="t('moveDownPersonal', { page: row.label })" :aria-label="t('moveDownPersonal', { page: row.label })" @click="movePersonalOrder(row.path, 1)">↓</button>
          <button
            v-if="auth.canEdit"
            class="page-tree-move"
            type="button"
            :title="t('movePageFolder')"
            :aria-label="t('movePageFolder')"
            @click="openMoveDialog(row.path)"
          >
            ↳
          </button>
        </span>
      </div>
    </template>
    </section>

    <section v-if="moveSourcePath" class="rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm">
      <div class="mb-2 font-medium">Move /{{ moveSourcePath }}</div>
      <label class="block text-xs text-[var(--c-text-muted)]">
        Destination folder
        <input v-model="moveDestinationFolder" class="input mt-1 font-mono text-sm" placeholder="docs/folder" />
      </label>
      <p class="mt-2 text-xs text-[var(--c-text-muted)]">
        New path: /{{ movedPath(moveSourcePath, moveDestinationFolder) }}
      </p>
      <p v-if="moveError" class="mt-2 text-xs text-red-600">{{ moveError }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="btn-primary py-1 text-xs" type="button" :disabled="moving" @click="moveWikiPage(moveSourcePath, moveDestinationFolder)">
          {{ moving ? 'Moving...' : 'Move page' }}
        </button>
        <button class="btn-ghost py-1 text-xs" type="button" :disabled="moving" @click="closeMoveDialog">{{ t('cancel') }}</button>
      </div>
    </section>
    <p v-if="moveNotice" class="text-xs text-green-600 dark:text-green-400">{{ moveNotice }}</p>
  </nav>
</template>
