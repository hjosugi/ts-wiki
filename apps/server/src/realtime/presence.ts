/**
 * Presence registry — who is currently on each page, and whether they're just
 * viewing or actively editing. A pure bookkeeping structure: the WebSocket layer
 * owns the sockets and calls join/leave here, then broadcasts `list(path)`.
 */
export type ViewerMode = 'viewing' | 'editing'

export interface Viewer {
  readonly id: string // connection id (one per socket/tab)
  readonly userId: string | null
  readonly name: string
  readonly mode: ViewerMode
}

/** A deduped viewer for display (one entry per user, editing wins). */
export interface ViewerView {
  readonly userId: string | null
  readonly name: string
  readonly mode: ViewerMode
}

export interface PresenceRegistry {
  join(path: string, connId: string, who: { userId: string | null; name: string; mode: ViewerMode }): void
  /** Remove a connection; returns the path it was on (to re-broadcast), or null. */
  leave(connId: string): string | null
  list(path: string): Viewer[]
}

export const createPresence = (): PresenceRegistry => {
  const byPath = new Map<string, Map<string, Viewer>>()
  const pathOf = new Map<string, string>()

  return {
    join(path, connId, who) {
      pathOf.set(connId, path)
      let viewers = byPath.get(path)
      if (!viewers) {
        viewers = new Map()
        byPath.set(path, viewers)
      }
      viewers.set(connId, { id: connId, userId: who.userId, name: who.name, mode: who.mode })
    },
    leave(connId) {
      const path = pathOf.get(connId)
      if (path === undefined) return null
      pathOf.delete(connId)
      const viewers = byPath.get(path)
      if (viewers) {
        viewers.delete(connId)
        if (viewers.size === 0) byPath.delete(path)
      }
      return path
    },
    list(path) {
      const viewers = byPath.get(path)
      return viewers ? [...viewers.values()] : []
    },
  }
}

/** Collapse multiple connections of the same user into one entry; editing wins. */
export const dedupeViewers = (viewers: readonly Viewer[]): ViewerView[] => {
  const map = new Map<string, ViewerView>()
  for (const v of viewers) {
    const key = v.userId ?? `anon:${v.id}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { userId: v.userId, name: v.name, mode: v.mode })
    } else if (v.mode === 'editing' && existing.mode !== 'editing') {
      map.set(key, { userId: existing.userId, name: existing.name, mode: 'editing' })
    }
  }
  return [...map.values()]
}
