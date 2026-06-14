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
} from '@wiki/core'

export interface GitConfig {
  readonly enabled: boolean
  readonly dir: string
  readonly branch: string
  readonly remote: string | null
  readonly authorName: string
  readonly authorEmail: string
  /** Where the last-imported commit marker is stored (outside the repo). */
  readonly markerFile: string
}

export interface PageForGit {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly content: string
}

export type GitAuthor = { name: string; email: string } | null

export interface GitSyncHandlers {
  upsert(path: string, file: PageFileData): void
  remove(path: string): void
}

export interface SyncResult {
  readonly enabled: boolean
  readonly pulled: boolean
  readonly upserted: string[]
  readonly deleted: string[]
}

export interface GitStatus {
  readonly enabled: boolean
  readonly dir: string
  readonly branch: string
  readonly remote: string | null
  readonly head: string | null
  readonly clean: boolean
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
      console.warn(`[git] commit failed: ${r.stderr.toString().trim()}`)
      return
    }
    writeMarker(await headSha()) // our own commit must not be re-imported
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
        mkdirSync(contentDir, { recursive: true })
        if (!existsSync(join(config.dir, '.git'))) {
          await git('init', '-b', config.branch)
          await git('config', 'user.name', config.authorName)
          await git('config', 'user.email', config.authorEmail)
          writeFileSync(join(config.dir, '.gitkeep'), '')
          await git('add', '-A')
          await git('commit', '-m', 'chore: initialize wiki content repo', '--allow-empty')
        }
        writeMarker(await headSha())
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
        if (!config.enabled) return { enabled: false, pulled: false, upserted: [], deleted: [] }

        let pulled = false
        if (config.remote) {
          const r = await git('pull', '--no-edit', '--no-rebase', config.remote, config.branch)
          pulled = r.exitCode === 0
        }

        const head = await headSha()
        const marker = readMarker()
        const upserted: string[] = []
        const deleted: string[] = []

        const apply = (status: string, file: string, renamedFrom?: string): void => {
          if (status.startsWith('R')) {
            if (renamedFrom) {
              const oldPath = filePathToPagePath(renamedFrom)
              if (oldPath) {
                handlers.remove(oldPath)
                deleted.push(oldPath)
              }
            }
            const newPath = filePathToPagePath(file)
            const data = readFile(file)
            if (newPath && data) {
              handlers.upsert(newPath, data)
              upserted.push(newPath)
            }
          } else if (status === 'D') {
            const path = filePathToPagePath(file)
            if (path) {
              handlers.remove(path)
              deleted.push(path)
            }
          } else {
            // A or M
            const path = filePathToPagePath(file)
            const data = readFile(file)
            if (path && data) {
              handlers.upsert(path, data)
              upserted.push(path)
            }
          }
        }

        if (marker && marker !== head) {
          const diff = await git('diff', '--name-status', '-M', `${marker}..HEAD`, '--', 'content')
          for (const line of diff.text().split('\n')) {
            if (!line.trim()) continue
            const parts = line.split('\t')
            if (parts[0]?.startsWith('R')) apply(parts[0], parts[2] ?? '', parts[1])
            else apply(parts[0] ?? '', parts[1] ?? '')
          }
        } else if (!marker) {
          // No marker yet: import every tracked content file.
          const files = await git('ls-files', 'content')
          for (const file of files.text().split('\n')) {
            if (file.trim()) apply('A', file)
          }
        }

        writeMarker(head)
        return { enabled: true, pulled, upserted, deleted }
      }),

    status: () =>
      serialize(async () => {
        if (!config.enabled) {
          return { enabled: false, dir: config.dir, branch: config.branch, remote: config.remote, head: null, clean: true }
        }
        const head = await headSha()
        const st = await git('status', '--porcelain')
        return {
          enabled: true,
          dir: config.dir,
          branch: config.branch,
          remote: config.remote,
          head,
          clean: st.text().trim() === '',
        }
      }),
  }
}
