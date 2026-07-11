import { t } from 'elysia'
import { type Principal, requirePermission, unauthorized } from '@kawaii-wiki/core'
import type { Services } from '../../services/index.ts'
import type { EventBus } from '../../realtime/bus.ts'
import { createCollabRuntime, createPresenceRuntime } from '../../realtime/runtime.ts'
import type { CollabSeed } from '../../realtime/collab.ts'
import { HttpError } from '../errors.ts'
import { requireHttpPermission } from '../permissions.ts'
import type { BaseApp } from '../base.ts'

export interface RealtimeRoutesContext {
  readonly services: Services
  readonly bus: EventBus
  readonly presenceRuntime: ReturnType<typeof createPresenceRuntime>
  readonly collab: ReturnType<typeof createCollabRuntime>
  readonly privateWiki: () => boolean
  readonly mintRealtimeTicket: (principal: Principal | null) => { ticket: string; expiresAt: number }
  readonly consumeRealtimeTicket: (ticket: string | null | undefined) => Promise<Principal | null>
}

export const createRealtimeRoutes = ({
  services,
  bus,
  presenceRuntime,
  collab,
  privateWiki,
  mintRealtimeTicket,
  consumeRealtimeTicket,
}: RealtimeRoutesContext) => (app: BaseApp) =>
  app
    .post('/api/realtime/ticket', ({ principal }) => mintRealtimeTicket(principal))
    .get('/api/events', async ({ request, query, principal }) => {
      const realtimePrincipal = principal ?? await consumeRealtimeTicket(query.ticket)
      if (!realtimePrincipal) throw new HttpError(unauthorized())
      requireHttpPermission(realtimePrincipal, 'page:read')

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
    }, { query: t.Object({ ticket: t.Optional(t.String()) }) })
    .ws('/api/presence', {
      query: t.Object({
        path: t.String(),
        ticket: t.Optional(t.String()),
        name: t.Optional(t.String()),
        userId: t.Optional(t.String()),
        mode: t.Optional(t.Union([t.Literal('viewing'), t.Literal('editing')])),
      }),
      open(ws) {
        void (async () => {
          const { path, ticket, mode } = ws.data.query
          const principal = await consumeRealtimeTicket(ticket)
          if (privateWiki() && !principal) {
            ws.close(1008, 'Authentication required')
            return
          }
          if (!requirePermission(principal, 'page:read', { path }).ok) {
            ws.close(1008, 'Read access required')
            return
          }
          const user = principal ? await services.users.findById(principal.id) : null
          presenceRuntime.open(ws.id, ws, path, {
            name: user?.name ?? 'Guest',
            userId: principal?.id,
            mode,
          })
        })().catch(() => ws.close(1011, 'Presence authentication failed'))
      },
      close(ws) {
        presenceRuntime.close(ws.id)
      },
    })
    .ws('/api/collab/:room', {
      query: t.Object({
        ticket: t.Optional(t.String()),
      }),
      open(ws) {
        void (async () => {
          const principal = await consumeRealtimeTicket(ws.data.query.ticket)
          const room = decodeURIComponent(ws.data.params.room)
          if (!principal || !requirePermission(principal, 'page:write', { path: room }).ok) {
            ws.close(1008, 'Authentication required')
            return
          }
          const current = services.pages.getByPath(room)
          const seed = (): CollabSeed => ({
            text: current.ok ? current.value.content : '',
            updatedAt: current.ok ? current.value.updatedAt : null,
          })
          collab.open(ws.id, room, (data) => ws.raw.send(data), seed, principal)
        })().catch(() => ws.close(1011, 'Collab authentication failed'))
      },
      message(ws, message) {
        collab.message(ws.id, message)
      },
      close(ws) {
        collab.close(ws.id)
      },
    })
