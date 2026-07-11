/**
 * Git storage backend — mirrors pages to a Git repository as Markdown files
 * (frontmatter + body), like Wiki.js. Two-way:
 *
 *   push:  page create/update/move/delete → write file + commit (DB → Git)
 *   sync:  git pull + diff since last import → upsert/delete in the DB (Git → DB)
 *
 * SQLite stays canonical. All git operations are serialized through a single
 * promise chain so commits never interleave. Shells out to `git` via Bun's `$`
 * (no extra dependency).
 *
 * Loop avoidance: every commit WE make advances the "last imported" marker to
 * HEAD, so our own pushes are never re-imported — only externally-authored
 * commits are pulled into the DB.
 */
import { $ } from 'bun'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  serializePageFile,
  parsePageFile,
  pageFilePath,
  filePathToPagePath,
  type PageFileData,
} from '@kawaii-wiki/core'

export interface GitConfig {
  readonly enabled: boolean
  readonly sourceOfTruth?: boolean
  readonly dir: string
  readonly branch: string
  /** Git remote name used for pull/push, e.g. origin. */
  readonly remote: string | null
  /** Clone URL/path used to bootstrap an empty working directory. */
  readonly remoteUrl?: string | null
  readonly authorName: string
  readonly authorEmail: string
  /** Where the last-imported commit marker is stored (outside the repo). */
  readonly markerFile: string
  readonly onError?: (event: { operation: string; message: string; occurredAt: number }) => void
}

export interface PageForGit {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly icon?: string
  readonly coverUrl?: string
  readonly coverPosition?: string
  readonly content: string
}

export type GitAuthor = { name: string; email: string } | null

export interface GitSyncHandlers {
  upsert(path: string, file: PageFileData): unknown | Promise<unknown>
  remove(path: string): unknown | Promise<unknown>
  /** Reconcile an existing DB against all paths tracked by Git on initial sync. */
  reconcile?(trackedPaths: readonly string[]): unknown | Promise<unknown>
}

export interface SyncResult {
  readonly enabled: boolean
  readonly pulled: boolean
  /** Whether local commits were pushed back to the remote (false if no remote). */
  readonly pushed: boolean
  readonly upserted: string[]
  readonly deleted: string[]
}

export interface GitStatus {
  readonly enabled: boolean
  readonly sourceOfTruth: boolean
  readonly dir: string
  readonly branch: string
  readonly remote: string | null
  readonly remoteUrl: string | null
  readonly head: string | null
  readonly clean: boolean
  readonly lastSuccessAt: number | null
  readonly lastErrorAt: number | null
  readonly lastError: string | null
}

export interface GitStorage {
  readonly enabled: boolean
  init(): Promise<void>
  savePage(page: PageForGit, author?: GitAuthor): Promise<void>
  movePage(fromPath: string, page: PageForGit, author?: GitAuthor): Promise<void>
  deletePage(path: string, author?: GitAuthor): Promise<void>
  sync(handlers: GitSyncHandlers): Promise<SyncResult>
  status(): Promise<GitStatus>
}

export const createGitStorage = (config: GitConfig): GitStorage => {
  const contentDir = join(config.dir, 'content')
  const remoteUrl = config.remoteUrl ?? null
  const remoteName = config.remote ?? (remoteUrl ? 'origin' : null)
  let lastSuccessAt: number | null = null
  let lastErrorAt: number | null = null
  let lastError: string | null = null
  let synchronized = false
  const failure = (operation: string, message: string): void => {
    lastErrorAt = Date.now()
    lastError = message || `${operation} failed`
    config.onError?.({ operation, message: lastError, occurredAt: lastErrorAt })
  }
  const success = (): void => {
    lastSuccessAt = Date.now()
    lastErrorAt = null
    lastError = null
  }

  // Serialize all git work through one chain (no interleaved commits).
  let chain: Promise<unknown> = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const git = (...args: string[]) => $`git -C ${config.dir} ${args}`.quiet().nothrow()

  const headSha = async (): Promise<string | null> => {
    const r = await git('rev-parse', 'HEAD')
    return r.exitCode === 0 ? r.text().trim() : null
  }

  const ensureRemote = async (): Promise<void> => {
    if (!remoteName || !remoteUrl) return
    const existing = await git('remote', 'get-url', remoteName)
    if (existing.exitCode === 0) return
    const added = await git('remote', 'add', remoteName, remoteUrl)
    if (added.exitCode !== 0) failure('remote.add', added.stderr.toString().trim())
  }

  const readMarker = (): string | null => {
    try {
      return (JSON.parse(readFileSync(config.markerFile, 'utf8')) as { commit?: string }).commit ?? null
    } catch {
      return null
    }
  }
  const writeMarker = (commit: string | null): void => {
    mkdirSync(dirname(config.markerFile), { recursive: true })
    writeFileSync(config.markerFile, JSON.stringify({ commit }))
  }

  const commit = async (message: string, author: GitAuthor): Promise<void> => {
    await git('add', '-A', 'content')
    const staged = await git('diff', '--cached', '--quiet')
    if (staged.exitCode === 0) return // nothing changed
    const authorArgs = author ? [`--author=${author.name} <${author.email}>`] : []
    const r = await git('commit', '-m', message, ...authorArgs)
    if (r.exitCode !== 0) {
      failure('commit', r.stderr.toString().trim())
      return
    }
    writeMarker(await headSha()) // our own commit must not be re-imported
    success()
  }

  const readFile = (repoRelFile: string): PageFileData | null => {
    try {
      return parsePageFile(readFileSync(join(config.dir, repoRelFile), 'utf8'))
    } catch {
      return null
    }
  }

  return {
    enabled: config.enabled,

    init: () =>
      serialize(async () => {
        if (!config.enabled) return
        mkdirSync(config.dir, { recursive: true })

        // First run with a clone URL: clone it so we share history (a fresh `git
        // init` would leave unrelated histories and break every pull). Clone into
        // the (empty) dir; if it fails — e.g. an empty remote — fall back to init.
        let cloned = false
        if (!existsSync(join(config.dir, '.git')) && remoteUrl) {
          const r = await $`git clone --origin ${remoteName ?? 'origin'} ${remoteUrl} ${config.dir}`.quiet().nothrow()
          cloned = r.exitCode === 0
          if (!cloned) {
            const message = r.stderr.toString().trim()
            failure('clone', message)
            if (config.sourceOfTruth) throw new Error(`Git source-of-truth clone failed: ${message}`)
          }
        }
        if (!existsSync(join(config.dir, '.git'))) {
          await git('init', '-b', config.branch)
          writeFileSync(join(config.dir, '.gitkeep'), '')
          await git('add', '-A')
          await git('commit', '-m', 'chore: initialize wiki content repo', '--allow-empty')
        }
        await git('config', 'user.name', config.authorName)
        await git('config', 'user.email', config.authorEmail)
        await ensureRemote()
        mkdirSync(contentDir, { recursive: true })

        // After a fresh clone leave the marker UNSET so the first sync imports
        // all existing remote content into the DB. Otherwise pin to HEAD so we
        // never re-import our own initial commit; a restart keeps any set marker.
        if (!cloned && readMarker() === null) writeMarker(await headSha())
        success()
      }),

    savePage: (page, author = null) =>
      serialize(async () => {
        if (!config.enabled) return
        const abs = join(contentDir, pageFilePath(page.path))
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, serializePageFile(page))
        await commit(`docs: update ${page.path}`, author)
      }),

    movePage: (fromPath, page, author = null) =>
      serialize(async () => {
        if (!config.enabled) return
        rmSync(join(contentDir, pageFilePath(fromPath)), { force: true })
        const abs = join(contentDir, pageFilePath(page.path))
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, serializePageFile(page))
        await commit(`docs: move ${fromPath} -> ${page.path}`, author)
      }),

    deletePage: (path, author = null) =>
      serialize(async () => {
        if (!config.enabled) return
        rmSync(join(contentDir, pageFilePath(path)), { force: true })
        await commit(`docs: delete ${path}`, author)
      }),

    sync: (handlers) =>
      serialize(async () => {
        if (!config.enabled) return { enabled: false, pulled: false, pushed: false, upserted: [], deleted: [] }

        let pulled = false
        if (remoteName) {
          const r = await git('pull', '--no-edit', '--no-rebase', remoteName, config.branch)
          pulled = r.exitCode === 0
          if (!pulled && config.sourceOfTruth) {
            const message = r.stderr.toString().trim()
            failure('pull', message)
            throw new Error(`Git source-of-truth pull failed: ${message}`)
          }
        }

        const head = await headSha()
        const marker = readMarker()
        const upserted: string[] = []
        const deleted: string[] = []

        const apply = async (status: string, file: string, renamedFrom?: string): Promise<void> => {
          if (status.startsWith('R')) {
            if (renamedFrom) {
              const oldPath = filePathToPagePath(renamedFrom)
              if (oldPath) {
                await handlers.remove(oldPath)
                deleted.push(oldPath)
              }
            }
            const newPath = filePathToPagePath(file)
            const data = readFile(file)
            if (newPath && data) {
              await handlers.upsert(newPath, data)
              upserted.push(newPath)
            }
          } else if (status === 'D') {
            const path = filePathToPagePath(file)
            if (path) {
              await handlers.remove(path)
              deleted.push(path)
            }
          } else {
            // A or M
            const path = filePathToPagePath(file)
            const data = readFile(file)
            if (path && data) {
              await handlers.upsert(path, data)
              upserted.push(path)
            }
          }
        }

        const initialAuthoritativeSync = Boolean(config.sourceOfTruth && !synchronized)

        if (initialAuthoritativeSync) {
          // A process restart must rebuild the database from the complete Git
          // tree even when the persisted marker already equals HEAD. This also
          // recovers pages that were archived during an earlier incomplete sync.
          const files = await git('ls-files', 'content')
          const trackedPaths: string[] = []
          for (const file of files.text().split('\n')) {
            if (!file.trim()) continue
            const path = filePathToPagePath(file.trim())
            if (path) trackedPaths.push(path)
            await apply('A', file)
          }
          // An empty/misconfigured remote must never erase the entire wiki.
          if (trackedPaths.length) await handlers.reconcile?.(trackedPaths)
        } else if (marker && marker !== head) {
          const diff = await git('diff', '--name-status', '-M', `${marker}..HEAD`, '--', 'content')
          for (const line of diff.text().split('\n')) {
            if (!line.trim()) continue
            const parts = line.split('\t')
            if (parts[0]?.startsWith('R')) await apply(parts[0], parts[2] ?? '', parts[1])
            else await apply(parts[0] ?? '', parts[1] ?? '')
          }
        } else if (!marker) {
          // No marker yet: import every tracked content file.
          const files = await git('ls-files', 'content')
          for (const file of files.text().split('\n')) {
            if (file.trim()) await apply('A', file)
          }
        }

        writeMarker(head)

        // Push local commits back to the remote (DB → Git → remote). Best-effort:
        // a failed push (auth, non-fast-forward) is reported, never thrown — the
        // next sync pulls first and retries.
        let pushed = false
        if (remoteName && head) {
          const r = await git('push', remoteName, `HEAD:${config.branch}`)
          pushed = r.exitCode === 0
          if (!pushed) failure('push', r.stderr.toString().trim())
          if (!pushed && config.sourceOfTruth) {
            throw new Error(`Git source-of-truth push failed: ${r.stderr.toString().trim()}`)
          }
        }

        if (!remoteName || pushed) success()
        synchronized = true

        return { enabled: true, pulled, pushed, upserted, deleted }
      }),

    status: () =>
      serialize(async () => {
        if (!config.enabled) {
          return {
            enabled: false,
            sourceOfTruth: Boolean(config.sourceOfTruth),
            dir: config.dir,
            branch: config.branch,
            remote: remoteName,
            remoteUrl,
            head: null,
            clean: true,
            lastSuccessAt,
            lastErrorAt,
            lastError,
          }
        }
        const head = await headSha()
        const st = await git('status', '--porcelain')
        return {
          enabled: true,
          sourceOfTruth: Boolean(config.sourceOfTruth),
          dir: config.dir,
          branch: config.branch,
          remote: remoteName,
          remoteUrl,
          head,
          clean: st.text().trim() === '',
          lastSuccessAt,
          lastErrorAt,
          lastError,
        }
      }),
  }
}
