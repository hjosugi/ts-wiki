<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Api, type PageSummary, type UserPreferenceKey, type UserPreferenceMap } from '@/lib/api'
import { paramToPath } from '@/router'
import { useAuth } from '@/stores/auth'

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
  depth: number
  isPage: boolean
  hasChildren: boolean
  collapsed: boolean
}

const props = defineProps<{
  pages: PageSummary[]
}>()

const route = useRoute()
const auth = useAuth()

const COLLAPSED_STORAGE_KEY = 'ts-wiki:collapsed-folders'
const STARRED_STORAGE_KEY = 'ts-wiki:starred-pages'
const RECENT_STORAGE_KEY = 'ts-wiki:recent-pages'
const ORDER_STORAGE_KEY = 'ts-wiki:page-order'
const COLLAPSED_PREFERENCE_KEY: UserPreferenceKey = 'nav:collapsed'
const STARRED_PREFERENCE_KEY: UserPreferenceKey = 'nav:starred'
const ORDER_PREFERENCE_KEY: UserPreferenceKey = 'nav:page-order'

const readStringList = (key: string): string[] => {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const readOrder = (): Record<string, number> => {
  if (typeof window === 'undefined') return {}
  try {
    const value = JSON.parse(window.localStorage.getItem(ORDER_STORAGE_KEY) ?? '{}')
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

function movePage(path: string, delta: -1 | 1): void {
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
      <div class="px-2 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Starred</div>
      <RouterLink
        v-for="page in starredPages"
        :key="'starred:' + page.path"
        :to="'/' + page.path"
        class="page-tree-row"
        active-class="page-tree-row-active"
      >
        {{ page.title }}
      </RouterLink>
    </section>

    <section v-if="recentPages.length" class="space-y-1">
      <div class="px-2 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Recent</div>
      <RouterLink
        v-for="page in recentPages"
        :key="'recent:' + page.path"
        :to="'/' + page.path"
        class="page-tree-row"
        active-class="page-tree-row-active"
      >
        {{ page.title }}
      </RouterLink>
    </section>

    <section class="flex flex-col gap-0.5">
    <template v-for="row in rows" :key="row.key">
      <div class="page-tree-line" :style="{ paddingLeft: 0.25 + row.depth * 0.75 + 'rem' }">
        <button
          v-if="row.hasChildren"
          class="page-tree-icon"
          type="button"
          :title="row.collapsed ? 'Expand folder' : 'Collapse folder'"
          @click="toggleCollapse(row.path)"
        >
          {{ row.collapsed ? '+' : '-' }}
        </button>
        <span v-else class="page-tree-spacer"></span>
        <RouterLink
          v-if="row.isPage"
          :to="'/' + row.path"
          class="page-tree-row"
          active-class="page-tree-row-active"
        >
          {{ row.label }}
        </RouterLink>
        <span v-else class="page-tree-folder">
          {{ row.label }}
        </span>
        <template v-if="row.isPage">
          <button class="page-tree-icon" type="button" title="Star page" @click="toggleStar(row.path)">
            {{ isStarred(row.path) ? '★' : '☆' }}
          </button>
          <button class="page-tree-icon" type="button" title="Move up" @click="movePage(row.path, -1)">^</button>
          <button class="page-tree-icon" type="button" title="Move down" @click="movePage(row.path, 1)">v</button>
        </template>
      </div>
    </template>
    </section>
  </nav>
</template>
