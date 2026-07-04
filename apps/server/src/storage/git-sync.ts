import type { Principal } from '@ts-wiki/core'
import type { Services } from '../services/index.ts'
import type { EventBus } from '../realtime/bus.ts'
import type { GitEnv } from '../env.ts'
import type { GitStorage, GitSyncHandlers } from './git.ts'
import type { Page } from '../db/schema.ts'

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
}

const DEFAULT_SYSTEM: Principal = { id: 'git-sync', role: 'admin' }

export const createGitSyncHandlers = ({
  services,
  bus,
  systemPrincipal = DEFAULT_SYSTEM,
  onPageWrite,
}: GitSyncRuntimeDeps): GitSyncHandlers => ({
  upsert: (path, file) => {
    const result = services.pages.upsertFromFile(path, file, {}, systemPrincipal)
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
  ;(timer as unknown as { unref?: () => void }).unref?.()
  console.log(`[git] auto-sync every ${gitEnv.syncIntervalMs}ms -> ${gitEnv.remote}`)

  return () => clearInterval(timer)
}
