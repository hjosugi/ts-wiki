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
import AppIcon from '@/components/AppIcon.vue'

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

interface NavDisplaySettings {
  showStarred: boolean
  showRecent: boolean
  showPages: boolean
  compact: boolean
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
const NAV_LAYOUT_VERSION_KEY = 'kawaii-wiki.ts:nav-layout-version'
const NAV_DISPLAY_STORAGE_KEY = 'kawaii-wiki.ts:nav-display'
const DEFAULT_NAV_DISPLAY: NavDisplaySettings = {
  showStarred: true,
  showRecent: true,
  showPages: true,
  compact: false,
}
const needsNavLayoutMigration = typeof window !== 'undefined'
  && window.localStorage.getItem(NAV_LAYOUT_VERSION_KEY) !== '2'
const storedCollapsedFolders = typeof window === 'undefined'
  ? null
  : readMigratedStorage(COLLAPSED_STORAGE_KEY, [legacyStorageKey(COLLAPSED_STORAGE_KEY)])

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

const readNavDisplay = (): NavDisplaySettings => {
  if (typeof window === 'undefined') return { ...DEFAULT_NAV_DISPLAY }
  try {
    const value = JSON.parse(window.localStorage.getItem(NAV_DISPLAY_STORAGE_KEY) ?? '{}') as Partial<NavDisplaySettings>
    return {
      showStarred: typeof value.showStarred === 'boolean' ? value.showStarred : true,
      showRecent: typeof value.showRecent === 'boolean' ? value.showRecent : true,
      showPages: typeof value.showPages === 'boolean' ? value.showPages : true,
      compact: typeof value.compact === 'boolean' ? value.compact : false,
    }
  } catch {
    return { ...DEFAULT_NAV_DISPLAY }
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
const treeFilter = ref('')
const navDisplay = ref(readNavDisplay())
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

const updateNavDisplay = (key: keyof NavDisplaySettings, value: boolean): void => {
  navDisplay.value = { ...navDisplay.value, [key]: value }
  persist(NAV_DISPLAY_STORAGE_KEY, navDisplay.value)
}

const persistPreference = (key: UserPreferenceKey, value: unknown): void => {
  if (!auth.isAuthed) return
  void Api.updatePreferences({ [key]: value } as UserPreferenceMap).catch(() => {})
}

const loadServerPreferences = async (): Promise<boolean> => {
  if (!auth.isAuthed) return false
  try {
    const preferences = await Api.preferences()
    const hasCollapsedPreference = hasPreference(preferences, COLLAPSED_PREFERENCE_KEY)
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
    return hasCollapsedPreference
  } catch {
    // Keep localStorage as the offline/source-of-last-resort state.
    return false
  }
}

const pageByPath = computed(() => new Map(props.pages.map((page) => [page.path, page])))
const starredPages = computed(() => starred.value.map((path) => pageByPath.value.get(path)).filter(Boolean) as PageSummary[])
const currentPath = computed(() => paramToPath(route.params.path))
const recentPages = computed(() => recent.value
  .map((path) => pageByPath.value.get(path))
  .filter((page): page is PageSummary => Boolean(page) && page?.path !== currentPath.value)
  .slice(0, 3))
const isCollapsed = (path: string): boolean => collapsed.value.includes(path)
const isStarred = (path: string): boolean => starred.value.includes(path)

const folderPaths = (): string[] => {
  const folders = new Set<string>()
  for (const page of props.pages) {
    const segments = page.path.split('/').filter(Boolean)
    for (let index = 1; index < segments.length; index += 1) {
      folders.add(segments.slice(0, index).join('/'))
    }
  }
  return [...folders]
}

const ancestorPaths = (path: string): Set<string> => {
  const segments = path.split('/').filter(Boolean)
  return new Set(segments.map((_, index) => segments.slice(0, index + 1).join('/')))
}

const initializeCollapsedFolders = (): void => {
  const open = ancestorPaths(currentPath.value)
  collapsed.value = folderPaths().filter((path) => !open.has(path))
  persist(COLLAPSED_STORAGE_KEY, collapsed.value)
}

watch(
  currentPath,
  (path) => {
    if (!path || !pageByPath.value.has(path)) return
    const open = ancestorPaths(path)
    const nextCollapsed = collapsed.value.filter((item) => !open.has(item))
    if (nextCollapsed.length !== collapsed.value.length) {
      collapsed.value = nextCollapsed
      persist(COLLAPSED_STORAGE_KEY, collapsed.value)
      persistPreference(COLLAPSED_PREFERENCE_KEY, collapsed.value)
    }
    recent.value = [path, ...recent.value.filter((item) => item !== path)].slice(0, 6)
    persist(RECENT_STORAGE_KEY, recent.value)
  },
  { immediate: true },
)

onMounted(() => {
  void loadServerPreferences().then((hasServerPreference) => {
    if (!hasServerPreference && (needsNavLayoutMigration || storedCollapsedFolders === null)) {
      initializeCollapsedFolders()
      window.localStorage.setItem(NAV_LAYOUT_VERSION_KEY, '2')
      persistPreference(COLLAPSED_PREFERENCE_KEY, collapsed.value)
    }
  })
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
  const query = treeFilter.value.trim().toLocaleLowerCase()
  const matchingPaths = query
    ? new Set(props.pages
        .filter((page) => [page.title, page.path, page.description, ...page.labels]
          .some((value) => value.toLocaleLowerCase().includes(query)))
        .map((page) => page.path))
    : null
  const branchMatches = (path: string): boolean =>
    !matchingPaths || [...matchingPaths].some((match) => match === path || match.startsWith(`${path}/`))
  const visit = (node: TreeNode, depth: number): void => {
    const children = [...node.children.values()].sort(compareNodes)
    for (const child of children) {
      if (!branchMatches(child.path)) continue
      out.push({
        key: child.key,
        label: child.label,
        path: child.path,
        icon: child.page?.icon ?? '',
        depth,
        isPage: Boolean(child.page),
        hasChildren: child.children.size > 0,
        collapsed: matchingPaths ? false : isCollapsed(child.path),
      })
      if (matchingPaths || !isCollapsed(child.path)) visit(child, depth + 1)
    }
  }
  visit(root, 0)
  return out
})
</script>

<template>
  <nav class="flex flex-col gap-3" :class="{ 'page-tree-compact': navDisplay.compact }">
    <div class="flex items-center gap-1.5">
      <label class="relative min-w-0 flex-1">
        <span class="sr-only">{{ t('filterPages') }}</span>
        <input
          v-model="treeFilter"
          class="input h-9 w-full py-1 pl-9 pr-8 text-sm"
          type="search"
          :placeholder="t('filterPages')"
        />
        <AppIcon class="pointer-events-none absolute left-3 top-2.5 text-[var(--c-text-muted)]" name="search" :size="15" />
        <button
          v-if="treeFilter"
          class="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)]"
          type="button"
          :aria-label="t('clearSearch')"
          @click="treeFilter = ''"
        >
          ×
        </button>
      </label>
      <details class="relative shrink-0">
        <summary
          class="icon-control inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)] hover:text-[var(--c-text)]"
          :aria-label="t('sidebarDisplay')"
          :data-tooltip="t('sidebarDisplay')"
          data-tooltip-align="end"
        >
          <AppIcon name="sliders" :size="16" />
        </summary>
        <div class="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3 shadow-lg">
          <p class="mb-2 text-sm font-semibold">{{ t('sidebarDisplay') }}</p>
          <label class="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
            <input :checked="navDisplay.showStarred" type="checkbox" @change="updateNavDisplay('showStarred', ($event.target as HTMLInputElement).checked)" />
            <AppIcon name="star" :size="15" />{{ t('showStarred') }}
          </label>
          <label class="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
            <input :checked="navDisplay.showRecent" type="checkbox" @change="updateNavDisplay('showRecent', ($event.target as HTMLInputElement).checked)" />
            <AppIcon name="history" :size="15" />{{ t('showRecent') }}
          </label>
          <label class="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
            <input :checked="navDisplay.showPages" type="checkbox" @change="updateNavDisplay('showPages', ($event.target as HTMLInputElement).checked)" />
            <AppIcon name="book" :size="15" />{{ t('showPageList') }}
          </label>
          <div class="my-2 border-t border-[var(--c-border)]"></div>
          <label class="flex cursor-pointer items-center justify-between gap-2 py-1.5 text-sm">
            <span>{{ t('compactSidebar') }}</span>
            <input :checked="navDisplay.compact" type="checkbox" @change="updateNavDisplay('compact', ($event.target as HTMLInputElement).checked)" />
          </label>
        </div>
      </details>
    </div>

    <section v-if="navDisplay.showStarred && starredPages.length" class="space-y-1">
      <div class="flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">
        <AppIcon name="star" :size="13" />{{ t('starred') }}
      </div>
      <RouterLink
        v-for="page in starredPages"
        :key="'starred:' + page.path"
        :to="'/' + page.path"
        class="page-tree-row"
        active-class="page-tree-row-active"
      >
        <span v-if="page.icon" aria-hidden="true">{{ page.icon }}</span>
        <AppIcon v-else name="book" :size="15" />
        <span class="truncate">{{ page.title }}</span>
      </RouterLink>
    </section>

    <details v-if="navDisplay.showRecent && recentPages.length" class="group/recent">
      <summary class="flex cursor-pointer list-none items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)]">
        <AppIcon name="history" :size="13" />
        <span class="flex-1">{{ t('recent') }}</span>
        <AppIcon class="group-open/recent:hidden" name="chevron-right" :size="13" />
        <AppIcon class="hidden group-open/recent:block" name="chevron-down" :size="13" />
      </summary>
      <div class="mt-1 space-y-1">
        <RouterLink
          v-for="page in recentPages"
          :key="'recent:' + page.path"
          :to="'/' + page.path"
          class="page-tree-row"
          active-class="page-tree-row-active"
        >
          <span v-if="page.icon" aria-hidden="true">{{ page.icon }}</span>
          <AppIcon v-else name="book" :size="15" />
          <span class="truncate">{{ page.title }}</span>
        </RouterLink>
      </div>
    </details>

    <section v-if="navDisplay.showPages" class="flex flex-col gap-0.5">
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
          <AppIcon :name="row.collapsed ? 'chevron-right' : 'chevron-down'" :size="14" />
        </button>
        <span v-else class="page-tree-spacer"></span>
        <RouterLink
          v-if="row.isPage"
          :to="'/' + row.path"
          class="page-tree-row"
          active-class="page-tree-row-active"
        >
          <span v-if="row.icon" class="shrink-0" aria-hidden="true">{{ row.icon }}</span>
          <AppIcon v-else name="book" :size="15" class="shrink-0 text-[var(--c-text-muted)]" />
          <span class="truncate">{{ row.label }}</span>
        </RouterLink>
        <span v-else class="page-tree-folder flex items-center gap-1.5">
          <AppIcon :name="row.collapsed ? 'folder' : 'folder-open'" :size="16" class="shrink-0" />
          <span class="truncate">{{ row.label }}</span>
        </span>
        <details v-if="row.isPage" class="page-tree-actions opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <summary class="page-tree-icon cursor-pointer list-none" :aria-label="t('moreActions')" @click.stop>
            <AppIcon name="more" :size="15" />
          </summary>
          <div class="page-tree-actions-menu">
            <button type="button" :title="t('starPage')" @click="toggleStar(row.path)">
              <AppIcon name="star" :size="14" />{{ isStarred(row.path) ? t('unstar') : t('starPage') }}
            </button>
            <button type="button" @click="movePersonalOrder(row.path, -1)">
              <AppIcon name="chevron-up" :size="14" />{{ t('moveUp') }}
            </button>
            <button type="button" @click="movePersonalOrder(row.path, 1)">
              <AppIcon name="chevron-down" :size="14" />{{ t('moveDown') }}
            </button>
            <button v-if="auth.canEdit" type="button" @click="openMoveDialog(row.path)">
              <AppIcon name="folder" :size="14" />{{ t('movePageFolder') }}
            </button>
          </div>
        </details>
      </div>
    </template>
      <p v-if="treeFilter && !rows.length" class="px-2 py-3 text-sm text-[var(--c-text-muted)]">
        {{ t('noMatchingPages') }}
      </p>
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
