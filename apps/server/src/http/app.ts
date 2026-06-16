/**
 * HTTP composition root. One chained Elysia instance so its type flows cleanly
 * into the Eden Treaty client (zero codegen). Cross-cutting concerns —
 * principal resolution, error mapping — are declared once here; handlers stay
 * thin and delegate to services.
 */
import { join } from 'node:path'
import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import { jwt } from '@elysiajs/jwt'
import { staticPlugin } from '@elysiajs/static'
import {
  type Principal,
  type Role,
  can,
  forbidden,
  unauthorized,
} from '@wiki/core'
import type { Env } from '../env.ts'
import type { DB } from '../db/client.ts'
import { createServices } from '../services/index.ts'
import { createDbEventBus, createEventBus } from '../realtime/bus.ts'
import { createPresence, dedupeViewers } from '../realtime/presence.ts'
import { createGitStorage, type GitConfig } from '../storage/git.ts'
import { createCollabHub, type CollabConn } from '../realtime/collab.ts'
import { verifyPassword } from '../services/auth.ts'
import type { User } from '../db/schema.ts'
import { HttpError, unwrap, toErrorResponse } from './errors.ts'

export interface AppDeps {
  readonly db: DB
  readonly env: Env
}

const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
})

const asRole = (value: unknown): Role | null =>
  value === 'admin' || value === 'editor' || value === 'viewer' ? value : null

export const createApp = ({ db, env }: AppDeps) => {
  const services = createServices(db)
  const bus =
    env.realtime.eventBus === 'db'
      ? createDbEventBus(db, {
          sourceId: env.realtime.instanceId,
          pollIntervalMs: env.realtime.pollIntervalMs,
        })
      : createEventBus()
  const presence = createPresence()
  // connId → live socket, for broadcasting presence updates per page.
  const sockets = new Map<string, { send: (data: string) => unknown }>()
  const broadcastPresence = (path: string) => {
    const viewers = presence.list(path)
    const message = JSON.stringify({ type: 'presence', path, viewers: dedupeViewers(viewers) })
    for (const viewer of viewers) sockets.get(viewer.id)?.send(message)
  }

  // ── Git storage (DB stays canonical; Git is a mirror + import source) ──────
  const gitConfig: GitConfig = { ...env.git, markerFile: join(env.dataDir, 'git-sync.json') }
  const git = createGitStorage(gitConfig)
  if (git.enabled) void git.init().catch((e) => console.warn('[git] init failed', e))

  const SYSTEM: Principal = { id: 'git-sync', role: 'admin' }
  const gitAuthor = (id: string | undefined): { name: string; email: string } | null => {
    if (!id) return null
    const u = services.users.findById(id)
    return u ? { name: u.name, email: u.email } : null
  }
  // Git → DB: apply imported files through the normal service (system principal).
  const gitSyncHandlers = {
    upsert: (path: string, file: { title: string; description: string; content: string }) => {
      const title = file.title || path.split('/').pop() || path
      const existing = services.pages.getByPath(path)
      const result = existing.ok
        ? services.pages.update(path, { title, description: file.description, content: file.content }, SYSTEM)
        : services.pages.create({ path, title, content: file.content, description: file.description }, SYSTEM)
      if (result.ok) {
        bus.emit({ type: 'page:changed', action: existing.ok ? 'updated' : 'created', path: result.value.path })
      }
    },
    remove: (path: string) => {
      if (services.pages.remove(path, SYSTEM).ok) bus.emit({ type: 'page:changed', action: 'deleted', path })
    },
  }

  // ── Collaborative editing (Yjs relay) ─────────────────────────────────────
  const COLLAB: Principal = { id: 'collab-autosave', role: 'editor' }
  const collab = createCollabHub({
    // Debounced autosave: persist the live doc WITHOUT a revision (an explicit
    // Save still snapshots history + commits to Git). Readers get page:changed.
    persist: (room, text) => {
      const result = services.pages.saveContent(room, text, COLLAB)
      if (result.ok) bus.emit({ type: 'page:changed', action: 'updated', path: result.value.path })
    },
  })
  const collabConns = new Map<string, { room: string; conn: CollabConn }>()
  const toBytes = (m: unknown): Uint8Array | null => {
    if (m instanceof Uint8Array) return m
    if (m instanceof ArrayBuffer) return new Uint8Array(m)
    if (ArrayBuffer.isView(m)) {
      const v = m as ArrayBufferView
      return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
    }
    return null
  }

  return (
    new Elysia()
      // Permissive CORS: the SPA uses Bearer tokens (not cookies), so it can run
      // on any localhost port without a fixed allowed-origin.
      .use(cors())
      .use(jwt({ name: 'jwt', secret: env.jwtSecret }))
      .use(staticPlugin({ assets: join(env.dataDir, 'assets'), prefix: '/assets' }))
      .decorate('services', services)
      // Resolve the current principal from a Bearer token on every request.
      .resolve(async ({ jwt, headers }): Promise<{ principal: Principal | null }> => {
        const auth = headers.authorization
        if (!auth?.startsWith('Bearer ')) return { principal: null }
        const payload = await jwt.verify(auth.slice(7))
        const role = payload ? asRole((payload as Record<string, unknown>).role) : null
        if (!payload || typeof payload.sub !== 'string' || !role) return { principal: null }
        return { principal: { id: payload.sub, role } }
      })
      .onError(({ error, set }) => {
        const { status, body } = toErrorResponse(error)
        set.status = status
        return body
      })

      // ── Health ────────────────────────────────────────────────────────────
      .get('/api/health', () => ({ ok: true as const, name: 'open-wiki', version: '0.1.0' }))

      // ── Auth ──────────────────────────────────────────────────────────────
      .post(
        '/api/auth/register',
        async ({ body, services, jwt }) => {
          // Bootstrap: the very first account becomes the admin.
          const role: Role = services.users.count() === 0 ? 'admin' : 'editor'
          const user = unwrap(await services.users.create({ ...body, role }))
          const token = await jwt.sign({ sub: user.id, role: user.role })
          return { token, user: publicUser(user) }
        },
        {
          body: t.Object({
            email: t.String({ minLength: 3 }),
            name: t.String({ minLength: 1 }),
            password: t.String({ minLength: 6 }),
          }),
        },
      )
      .post(
        '/api/auth/login',
        async ({ body, services, jwt }) => {
          const user = services.users.findByEmail(body.email)
          if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
            throw new HttpError(unauthorized('Invalid email or password'))
          }
          const token = await jwt.sign({ sub: user.id, role: user.role })
          return { token, user: publicUser(user) }
        },
        { body: t.Object({ email: t.String(), password: t.String() }) },
      )
      .get('/api/auth/me', ({ principal, services }) => {
        if (!principal) throw new HttpError(unauthorized())
        const user = services.users.findById(principal.id)
        if (!user) throw new HttpError(unauthorized())
        return { user: publicUser(user) }
      })

      // ── Pages: collection ─────────────────────────────────────────────────
      .get('/api/pages', ({ services }) => ({ pages: services.pages.list() }))
      .get('/api/graph', ({ services }) => services.pages.graph())
      .post(
        '/api/pages',
        ({ body, services, principal }) => {
          const page = unwrap(services.pages.create(body, principal))
          bus.emit({ type: 'page:changed', action: 'created', path: page.path })
          void git.savePage(page, gitAuthor(principal?.id))
          return { page }
        },
        {
          body: t.Object({
            path: t.String(),
            title: t.String(),
            content: t.String(),
            description: t.Optional(t.String()),
          }),
        },
      )

      // ── Pages: single (path is a query param so it may contain slashes) ───
      .get(
        '/api/page',
        ({ query, services }) => ({ page: unwrap(services.pages.getByPath(query.path)) }),
        { query: t.Object({ path: t.String() }) },
      )
      .put(
        '/api/page',
        ({ query, body, services, principal }) => {
          const page = unwrap(services.pages.update(query.path, body, principal))
          bus.emit({ type: 'page:changed', action: 'updated', path: page.path })
          void git.savePage(page, gitAuthor(principal?.id))
          return { page }
        },
        {
          query: t.Object({ path: t.String() }),
          body: t.Object({
            title: t.Optional(t.String()),
            content: t.Optional(t.String()),
            description: t.Optional(t.String()),
          }),
        },
      )
      .post(
        '/api/page/move',
        ({ body, services, principal }) => {
          const page = unwrap(services.pages.move(body.oldPath, body.newPath, principal))
          bus.emit({ type: 'page:changed', action: 'moved', path: page.path, from: body.oldPath })
          void git.movePage(body.oldPath, page, gitAuthor(principal?.id))
          return { page }
        },
        {
          body: t.Object({
            oldPath: t.String(),
            newPath: t.String(),
          }),
        },
      )
      .delete(
        '/api/page',
        ({ query, services, principal }) => {
          const result = unwrap(services.pages.remove(query.path, principal))
          bus.emit({ type: 'page:changed', action: 'deleted', path: result.path })
          void git.deletePage(result.path, gitAuthor(principal?.id))
          return result
        },
        { query: t.Object({ path: t.String() }) },
      )

      // ── Search ────────────────────────────────────────────────────────────
      .get('/api/search', ({ query, services }) => services.search.search(query.q ?? '', query.limit), {
        query: t.Object({
          q: t.Optional(t.String()),
          limit: t.Optional(t.Numeric()),
        }),
      })

      // ── Realtime (Server-Sent Events; any transport subscribes to the bus) ─
      .get('/api/events', ({ request }) => {
        const encoder = new TextEncoder()
        let unsubscribe: (() => void) | null = null
        let heartbeat: ReturnType<typeof setInterval> | null = null
        const cleanup = () => {
          unsubscribe?.()
          unsubscribe = null
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
        }
        const stream = new ReadableStream({
          start(controller) {
            const sse = (text: string) => {
              try {
                controller.enqueue(encoder.encode(text))
              } catch {
                cleanup()
              }
            }
            sse(': connected\n\n')
            unsubscribe = bus.subscribe((event) => sse(`data: ${JSON.stringify(event)}\n\n`))
            heartbeat = setInterval(() => sse(': ping\n\n'), 25000)
            request.signal.addEventListener('abort', () => {
              cleanup()
              try {
                controller.close()
              } catch {
                /* already closed */
              }
            })
          },
          cancel: cleanup,
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        })
      })

      // ── Presence (WebSocket; one connection per open page) ────────────────
      // Identity (name/userId) comes from the query for v0 — presence is
      // cosmetic, so we don't verify a token over the socket here.
      .ws('/api/presence', {
        query: t.Object({
          path: t.String(),
          name: t.Optional(t.String()),
          userId: t.Optional(t.String()),
          mode: t.Optional(t.Union([t.Literal('viewing'), t.Literal('editing')])),
        }),
        open(ws) {
          const { path, name, userId, mode } = ws.data.query
          sockets.set(ws.id, ws)
          presence.join(path, ws.id, {
            userId: userId ?? null,
            name: (name ?? '').trim() || 'Anonymous',
            mode: mode ?? 'viewing',
          })
          broadcastPresence(path)
        },
        close(ws) {
          sockets.delete(ws.id)
          const path = presence.leave(ws.id)
          if (path) broadcastPresence(path)
        },
      })

      // ── Collaborative editing (Yjs over WebSocket; room = page path) ───────
      .ws('/api/collab/:room', {
        open(ws) {
          const room = decodeURIComponent(ws.data.params.room)
          // ws.raw is the Bun socket — Elysia's ws.send() coerces binary to text.
          const conn: CollabConn = { send: (data) => void ws.raw.send(data) }
          collabConns.set(ws.id, { room, conn })
          collab.open(room, conn, () => {
            const r = services.pages.getByPath(room)
            return r.ok ? r.value.content : ''
          })
        },
        message(ws, message) {
          const entry = collabConns.get(ws.id)
          if (!entry) return
          const bytes = toBytes(message)
          if (bytes) collab.message(entry.room, entry.conn, bytes)
        },
        close(ws) {
          const entry = collabConns.get(ws.id)
          if (entry) {
            collab.close(entry.room, entry.conn)
            collabConns.delete(ws.id)
          }
        },
      })

      // ── Admin (each method gates on admin:access inside the service) ───────
      .get('/api/admin/stats', ({ services, principal }) => unwrap(services.admin.stats(principal)))
      .get('/api/admin/users', ({ services, principal }) => ({
        users: unwrap(services.admin.listUsers(principal)),
      }))
      .put(
        '/api/admin/users/role',
        ({ body, services, principal }) => ({
          user: unwrap(services.admin.setUserRole(principal, body.userId, body.role)),
        }),
        {
          body: t.Object({
            userId: t.String(),
            role: t.Union([t.Literal('admin'), t.Literal('editor'), t.Literal('viewer')]),
          }),
        },
      )

      // ── Git storage (admin) ───────────────────────────────────────────────
      .get('/api/git/status', ({ principal }) => {
        if (!can(principal, 'admin:access')) throw new HttpError(forbidden())
        return git.status()
      })
      .post('/api/git/sync', ({ principal }) => {
        if (!can(principal, 'admin:access')) throw new HttpError(forbidden())
        return git.sync(gitSyncHandlers)
      })

      // ── Assets ────────────────────────────────────────────────────────────
      .post(
        '/api/assets',
        async ({ body, services, principal }) => {
          if (!can(principal, 'page:write')) throw new HttpError(forbidden())
          const file = body.file
          const safeName = `${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]+/g, '_')}`
          await Bun.write(join(env.dataDir, 'assets', safeName), file)
          const asset = services.assets.record({
            filename: file.name,
            mime: file.type,
            size: file.size,
            authorId: principal?.id ?? null,
          })
          return { id: asset.id, filename: asset.filename, url: `/assets/${safeName}` }
        },
        { body: t.Object({ file: t.File() }) },
      )
  )
}

export type App = ReturnType<typeof createApp>
