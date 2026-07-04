/**
 * Realtime client — subscribes to the server's SSE stream (`/api/events`) and
 * fans `page:changed` events out to in-app listeners. EventSource reconnects
 * automatically, so this is fire-and-forget. (Transport is intentionally hidden
 * behind `onWikiEvent`, so we can swap SSE → WebSocket without touching callers.)
 */
import { getToken } from './api'
import { API_BASE_URL } from './url'

export interface WikiEvent {
  type: 'page:changed'
  action: 'created' | 'updated' | 'moved' | 'deleted'
  path: string
  from?: string
}

type Listener = (event: WikiEvent) => void

const listeners = new Set<Listener>()
let source: EventSource | null = null

export function connectRealtime(): void {
  if (source) return
  const token = getToken()
  const url = new URL('/api/events', API_BASE_URL)
  if (token) url.searchParams.set('token', token)
  source = new EventSource(url.toString())
  source.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as WikiEvent
      if (event?.type === 'page:changed') {
        for (const listener of listeners) listener(event)
      }
    } catch {
      /* ignore malformed frames */
    }
  }
  // On error EventSource retries on its own; nothing to do here.
}

export function onWikiEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
