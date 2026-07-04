/**
 * Presence client — one WebSocket per open page. The server broadcasts the
 * current viewer list for that page whenever someone joins or leaves.
 *
 * Identity (name/userId) is sent in the query — presence is cosmetic, so this
 * is fine for now. Hidden behind `connectPresence` so the transport can change.
 */
import { WS_BASE_URL } from './url'

export type ViewerMode = 'viewing' | 'editing'

export interface PresenceViewer {
  userId: string | null
  name: string
  mode: ViewerMode
}

export function connectPresence(
  path: string,
  identity: { name: string; userId: string | null; mode: ViewerMode },
  onViewers: (viewers: PresenceViewer[]) => void,
): () => void {
  const params = new URLSearchParams({ path, name: identity.name, mode: identity.mode })
  if (identity.userId) params.set('userId', identity.userId)

  let ws: WebSocket | null = new WebSocket(`${WS_BASE_URL}/api/presence?${params.toString()}`)

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg?.type === 'presence' && msg.path === path) {
        onViewers(Array.isArray(msg.viewers) ? msg.viewers : [])
      }
    } catch {
      /* ignore malformed frames */
    }
  }

  return () => {
    const socket = ws
    ws = null
    socket?.close()
  }
}
