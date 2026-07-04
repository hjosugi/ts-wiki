import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { Api, getToken } from '@/lib/api'
import { useAuth } from '@/stores/auth'

// Underscore-prefixed routes are reserved actions; everything else is a wiki
// path resolved against the page store (the Wiki.js convention, simplified).
export const routes: RouteRecordRaw[] = [
  { path: '/_login', name: 'login', component: () => import('@/views/LoginView.vue') },
  { path: '/_search', name: 'search', component: () => import('@/views/SearchView.vue') },
  { path: '/_events', name: 'events', component: () => import('@/views/EventsView.vue') },
  { path: '/_graph', name: 'graph', component: () => import('@/views/GraphView.vue') },
  { path: '/_admin', name: 'admin', component: () => import('@/views/AdminView.vue'), meta: { requiresAdmin: true } },
  { path: '/_history/:path(.*)*', name: 'history', component: () => import('@/views/HistoryView.vue') },
  { path: '/_new', name: 'new', component: () => import('@/views/PageEdit.vue'), meta: { requiresEdit: true } },
  {
    path: '/_edit/:path(.*)*',
    name: 'edit',
    component: () => import('@/views/PageEdit.vue'),
    meta: { requiresEdit: true },
  },
  {
    path: '/:path(.*)*',
    name: 'page',
    component: () => import('@/views/PageView.vue'),
  },
]

export const createWikiRouter = () => {
  let privateWiki: boolean | null = null
  const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior(to) {
      if (to.hash) return { el: to.hash, behavior: 'smooth' }
      return { top: 0 }
    },
  })

  router.beforeEach(async (to) => {
    const auth = useAuth()
    if (!auth.ready && getToken()) await auth.fetchMe()
    if (!getToken() && to.name !== 'login') {
      if (privateWiki === null) {
        privateWiki = await Api.publicSettings().then((settings) => settings.privateWiki).catch(() => false)
      }
      if (privateWiki) return { name: 'login', query: { redirect: to.fullPath } }
    }
    const requiresAdmin = Boolean(to.meta.requiresAdmin)
    const requiresEdit = Boolean(to.meta.requiresEdit)
    if ((requiresAdmin && !auth.isAdmin) || (requiresEdit && !auth.canEdit)) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }
  })

  return router
}

export const router = createWikiRouter()

/** Join a vue-router wildcard `:path(.*)*` param into a wiki path string. */
export const paramToPath = (param: unknown): string =>
  Array.isArray(param) ? param.join('/') : String(param ?? '')
