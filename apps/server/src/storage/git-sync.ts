import type { Principal } from '@kawaii-wiki/core'
import type { Services } from '../services/index.ts'
import type { EventBus } from '../realtime/bus.ts'
import type { GitEnv } from '../env.ts'
import type { GitStorage, GitSyncHandlers } from './git.ts'
import type { Page } from '../db/schema.ts'
import { unrefTimer } from '../utils/timers.ts'

export interface GitSyncPageWrite {
  readonly action: 'created' | 'updated' | 'deleted'
  readonly page?: Page
  readonly path: string
  readonly principal: Principal
}

export interface GitSyncRuntimeDeps {
  readonly services: Services
  readonly bus: EventBus
  readonly systemPrincipal?: Principal
  readonly onPageWrite?: (write: GitSyncPageWrite) => void
  readonly authoritative?: boolean
}

const DEFAULT_SYSTEM: Principal = { id: 'git-sync', role: 'admin' }

export const createGitSyncHandlers = ({
  services,
  bus,
  systemPrincipal = DEFAULT_SYSTEM,
  onPageWrite,
  authoritative = false,
}: GitSyncRuntimeDeps): GitSyncHandlers => ({
  upsert: async (path, file) => {
    // A previous authoritative reconciliation may have archived this path while
    // the remote was empty or incomplete. Bring it back before applying Git so
    // imports cannot silently conflict with the trash entry forever.
    if (authoritative && (await services.pages.trash()).some((page) => page.path === path)) {
      services.pages.restore(path, systemPrincipal)
    }
    const result = services.pages.upsertFromFile(
      path,
      file,
      authoritative ? { status: 'verified' } : {},
      systemPrincipal,
    )
    if (result.ok) {
      const action = result.value.created ? 'created' : 'updated'
      if (onPageWrite) onPageWrite({ action, page: result.value.page, path: result.value.page.path, principal: systemPrincipal })
      else bus.emit({ type: 'page:changed', action, path: result.value.page.path })
    }
  },
  remove: (path) => {
    if (services.pages.remove(path, systemPrincipal).ok) {
      if (onPageWrite) onPageWrite({ action: 'deleted', path, principal: systemPrincipal })
      else bus.emit({ type: 'page:changed', action: 'deleted', path })
    }
  },
  reconcile: authoritative
    ? async (trackedPaths) => {
        const tracked = new Set(trackedPaths)
        for (const page of await services.pages.allActive()) {
          if (!tracked.has(page.path)) {
            const result = services.pages.remove(page.path, systemPrincipal)
            if (result.ok) {
              if (onPageWrite) onPageWrite({ action: 'deleted', path: page.path, principal: systemPrincipal })
              else bus.emit({ type: 'page:changed', action: 'deleted', path: page.path })
            }
          }
        }
      }
    : undefined,
})

export const startGitSyncScheduler = (
  git: GitStorage,
  gitEnv: GitEnv,
  handlers: GitSyncHandlers,
  onError: (error: unknown) => void = (error) => console.warn('[git] auto-sync failed', error),
): (() => void) => {
  if (!git.enabled || !gitEnv.remote || gitEnv.syncIntervalMs <= 0) return () => {}

  const timer = setInterval(() => {
    void git.sync(handlers).catch(onError)
  }, gitEnv.syncIntervalMs)
  unrefTimer(timer)
  console.log(`[git] auto-sync every ${gitEnv.syncIntervalMs}ms -> ${gitEnv.remote}`)

  return () => clearInterval(timer)
}
