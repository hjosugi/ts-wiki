import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { Api, getToken } from '@/lib/api'
import { useAuth } from '@/stores/auth'

// Underscore-prefixed routes are reserved actions; everything else is a wiki
// path resolved against the page store (the Wiki.js convention, simplified).
export const routes: RouteRecordRaw[] = [
  { path: '/_login', name: 'login', component: () => import('@/views/LoginView.vue') },
  { path: '/_reset', name: 'reset-password', component: () => import('@/views/LoginView.vue') },
  { path: '/_verify-email', name: 'verify-email', component: () => import('@/views/LoginView.vue') },
  { path: '/setup', name: 'setup', component: () => import('@/views/SetupView.vue') },
  { path: '/_search', name: 'search', component: () => import('@/views/SearchView.vue') },
  { path: '/_events', name: 'events', component: () => import('@/views/EventsView.vue') },
  { path: '/_graph', name: 'graph', component: () => import('@/views/GraphView.vue') },
  { path: '/_tags', name: 'tags', component: () => import('@/views/TagsView.vue') },
  { path: '/_links', name: 'links', component: () => import('@/views/LinksView.vue') },
  { path: '/_changes', name: 'changes', component: () => import('@/views/ChangesView.vue') },
  { path: '/_share/:token', name: 'shared', component: () => import('@/views/SharedPageView.vue') },
  { path: '/_redirects', name: 'redirects', component: () => import('@/components/admin/AdminRedirectsPanel.vue'), meta: { requiresEdit: true } },
  { path: '/_templates', name: 'templates', component: () => import('@/views/PageTemplatesView.vue'), meta: { requiresEdit: true } },
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
  let setupNeeded: boolean | null = null
  const anonymousAllowedRoutes = new Set(['login', 'reset-password', 'verify-email', 'setup', 'shared'])
  const needsFirstRunSetup = async (): Promise<boolean> => {
    if (setupNeeded === false) return false
    setupNeeded = await Api.setupStatus().then((status) => status.needsSetup).catch(() => false)
    return setupNeeded
  }
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
    const needsSetup = await needsFirstRunSetup()
    if (needsSetup && to.name !== 'setup') return { name: 'setup', query: { redirect: to.fullPath } }
    if (!needsSetup && to.name === 'setup') return { path: '/' }

    if (!auth.ready && getToken()) await auth.fetchMe()
    if (!getToken() && !anonymousAllowedRoutes.has(String(to.name))) {
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
