<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { PageSummary } from '@/lib/api'
import { paramToPath } from '@/router'

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
    const value = JSON.parse(window.localStorage.getItem('ts-wiki:page-order') ?? '{}')
    return value && typeof value === 'object' ? (value as Record<string, number>) : {}
  } catch {
    return {}
  }
}

const collapsed = ref(readStringList('ts-wiki:collapsed-folders'))
const starred = ref(readStringList('ts-wiki:starred-pages'))
const recent = ref(readStringList('ts-wiki:recent-pages'))
const manualOrder = ref(readOrder())

const persist = (key: string, value: unknown): void => {
  window.localStorage.setItem(key, JSON.stringify(value))
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
    persist('ts-wiki:recent-pages', recent.value)
  },
  { immediate: true },
)

function toggleCollapse(path: string): void {
  collapsed.value = isCollapsed(path)
    ? collapsed.value.filter((item) => item !== path)
    : [...collapsed.value, path]
  persist('ts-wiki:collapsed-folders', collapsed.value)
}

function toggleStar(path: string): void {
  starred.value = isStarred(path)
    ? starred.value.filter((item) => item !== path)
    : [path, ...starred.value]
  persist('ts-wiki:starred-pages', starred.value)
}

function movePage(path: string, delta: -1 | 1): void {
  const ordered = [...props.pages].sort((a, b) => {
    const aOrder = manualOrder.value[a.path] ?? Number.MAX_SAFE_INTEGER
    const bOrder = manualOrder.value[b.path] ?? Number.MAX_SAFE_INTEGER
    return aOrder - bOrder || a.path.localeCompare(b.path)
  })
  const index = ordered.findIndex((page) => page.path === path)
  const next = index + delta
  if (index < 0 || next < 0 || next >= ordered.length) return
  const [page] = ordered.splice(index, 1)
  if (!page) return
  ordered.splice(next, 0, page)
  manualOrder.value = Object.fromEntries(ordered.map((item, order) => [item.path, order]))
  persist('ts-wiki:page-order', manualOrder.value)
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
    const children = [...node.children.values()].sort((a, b) => {
      const aOrder = a.page ? manualOrder.value[a.page.path] ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
      const bOrder = b.page ? manualOrder.value[b.page.path] ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
      return aOrder - bOrder || a.label.localeCompare(b.label)
    })
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
