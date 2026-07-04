/**
 * Typed API client via Eden Treaty. The `App` type comes straight from the
 * server with no codegen, so every *request* below — path, query, and body —
 * is checked against the real routes. Change a route signature and this file
 * stops compiling.
 *
 * Note on response typing: because the server uses a global `onError` that
 * returns a JSON body, Elysia unions that error shape into each route's success
 * type. Rather than narrow that union at every call site, we state the expected
 * success shape once per method via `call<T>()` and unwrap Eden's envelope here.
 */
import { treaty } from '@elysiajs/eden'
import type { App } from '@ts-wiki/server/app'
import { API_BASE_URL } from './url'

let authToken: string | null = localStorage.getItem('token')

export const getToken = (): string | null => authToken
export const setToken = (token: string | null): void => {
  authToken = token
  if (token) localStorage.setItem('token', token)
  else localStorage.removeItem('token')
}

/** A fresh treaty instance per call so the current token is always attached. */
const client = () =>
  treaty<App>(API_BASE_URL, {
    headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
  })

const messageOf = (error: unknown): string => {
  const e = error as
    | { value?: { error?: { message?: string }; message?: string }; status?: number }
    | null
    | undefined
  return e?.value?.error?.message ?? e?.value?.message ?? `Request failed (${e?.status ?? '?'})`
}

/** Await an Eden call, throw on error, and return the (asserted) success body. */
const call = async <T>(promise: Promise<{ data: unknown; error: unknown }>): Promise<T> => {
  const res = await promise
  if (res.error) throw new Error(messageOf(res.error))
  return res.data as T
}

// ── Domain types (the shapes the server returns) ─────────────────────────────
export interface PublicUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
}
export interface Page {
  id: string
  path: string
  title: string
  description: string
  content: string
  renderedHtml: string
  toc: string
  contentType: string
  authorId: string | null
  createdAt: number
  updatedAt: number
}
export interface PageSummary {
  path: string
  title: string
  description: string
  updatedAt: number
}
export interface SearchHit {
  path: string
  title: string
  snippet: string
  rank: number
}
export interface PageGraphNode {
  path: string
  title: string
  kind: 'page' | 'missing'
}
export interface PageGraphEdge {
  source: string
  target: string
  kind: 'wikilink' | 'markdown'
}
export interface PageGraph {
  nodes: PageGraphNode[]
  edges: PageGraphEdge[]
}
export interface AdminUserView {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  createdAt: number
}
export interface AdminStats {
  users: number
  pages: number
  revisions: number
}
interface AuthResult {
  token: string
  user: PublicUser
}

export const Api = {
  health: () => call<{ ok: true; name: string; version: string }>(client().api.health.get()),

  // Auth
  register: (body: { email: string; name: string; password: string }) =>
    call<AuthResult>(client().api.auth.register.post(body)),
  login: (body: { email: string; password: string }) =>
    call<AuthResult>(client().api.auth.login.post(body)),
  me: () => call<{ user: PublicUser }>(client().api.auth.me.get()).then((d) => d.user),

  // Pages
  listPages: () => call<{ pages: PageSummary[] }>(client().api.pages.get()).then((d) => d.pages),
  getPage: (path: string) =>
    call<{ page: Page }>(client().api.page.get({ query: { path } })).then((d) => d.page),
  createPage: (body: { path: string; title: string; content: string; description?: string }) =>
    call<{ page: Page }>(client().api.pages.post(body)).then((d) => d.page),
  updatePage: (path: string, body: { title?: string; content?: string; description?: string }) =>
    call<{ page: Page }>(client().api.page.put(body, { query: { path } })).then((d) => d.page),
  movePage: (oldPath: string, newPath: string) =>
    call<{ page: Page }>(client().api.page.move.post({ oldPath, newPath })).then((d) => d.page),
  deletePage: (path: string) =>
    call<{ path: string }>(client().api.page.delete(null, { query: { path } })),
  graph: () => call<PageGraph>(client().api.graph.get()),

  // Search
  search: (q: string, limit = 20) =>
    call<{ query: string; hits: SearchHit[] }>(client().api.search.get({ query: { q, limit } })),

  // Admin
  adminStats: () => call<AdminStats>(client().api.admin.stats.get()),
  adminUsers: () =>
    call<{ users: AdminUserView[] }>(client().api.admin.users.get()).then((d) => d.users),
  adminSetRole: (userId: string, role: 'admin' | 'editor' | 'viewer') =>
    call<{ user: AdminUserView }>(client().api.admin.users.role.put({ userId, role })).then(
      (d) => d.user,
    ),
}
