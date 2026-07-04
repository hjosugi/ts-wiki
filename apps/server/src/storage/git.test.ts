import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePageFile } from '@ts-wiki/core'
import { createGitStorage, type GitConfig } from './git.ts'

const GIT_TEST_TIMEOUT_MS = 15_000

const mkConfig = (): GitConfig & { root: string } => {
  const root = mkdtempSync(join(tmpdir(), 'ow-git-'))
  return {
    enabled: true,
    dir: join(root, 'repo'),
    branch: 'main',
    remote: null,
    remoteUrl: null,
    authorName: 'Test',
    authorEmail: 'test@localhost',
    markerFile: join(root, 'git-sync.json'),
    root,
  }
}

describe('git storage', () => {
  test('savePage writes a committed markdown file', async () => {
    const cfg = mkConfig()
    const git = createGitStorage(cfg)
    await git.init()
    await git.savePage({ path: 'docs/intro', title: 'Intro', description: 'd', content: '# Hi\n\nbody' })

    const file = join(cfg.dir, 'content', 'docs', 'intro.md')
    expect(existsSync(file)).toBe(true)
    expect(parsePageFile(readFileSync(file, 'utf8')).title).toBe('Intro')

    const st = await git.status()
    expect(st.clean).toBe(true) // committed, nothing pending
    expect(st.head).toBeTruthy()
    rmSync(cfg.root, { recursive: true, force: true })
  }, GIT_TEST_TIMEOUT_MS)

  test('deletePage removes the file', async () => {
    const cfg = mkConfig()
    const git = createGitStorage(cfg)
    await git.init()
    await git.savePage({ path: 'tmp', title: 'T', description: '', content: 'x' })
    expect(existsSync(join(cfg.dir, 'content', 'tmp.md'))).toBe(true)
    await git.deletePage('tmp')
    expect(existsSync(join(cfg.dir, 'content', 'tmp.md'))).toBe(false)
    rmSync(cfg.root, { recursive: true, force: true })
  }, GIT_TEST_TIMEOUT_MS)

  test('sync imports an externally-committed file (Git → DB)', async () => {
    const cfg = mkConfig()
    const git = createGitStorage(cfg)
    await git.init()

    // Simulate an external edit committed straight into the repo.
    mkdirSync(join(cfg.dir, 'content'), { recursive: true })
    writeFileSync(
      join(cfg.dir, 'content', 'external.md'),
      '---\ntitle: External\ndescription: ext\n---\n\nfrom git\n',
    )
    await $`git -C ${cfg.dir} add -A`.quiet().nothrow()
    await $`git -C ${cfg.dir} commit -m external`.quiet().nothrow()

    const imported: Array<{ path: string; title: string }> = []
    const res = await git.sync({
      upsert: (path, file) => imported.push({ path, title: file.title }),
      remove: () => {},
    })

    expect(res.upserted).toContain('external')
    expect(imported.find((i) => i.path === 'external')?.title).toBe('External')
    rmSync(cfg.root, { recursive: true, force: true })
  }, GIT_TEST_TIMEOUT_MS)

  test('sync pushes local commits to the remote (DB → Git → remote)', async () => {
    const cfg = mkConfig()
    // A bare repo acts as the "remote" we push to.
    const remote = join(cfg.root, 'remote.git')
    await $`git init --bare -b main ${remote}`.quiet().nothrow()

    const git = createGitStorage({ ...cfg, remoteUrl: remote })
    await git.init()
    await git.savePage({ path: 'shared', title: 'Shared', description: '', content: 'hello' })

    const res = await git.sync({ upsert: () => {}, remove: () => {} })
    expect(res.pushed).toBe(true)

    // Clone the remote elsewhere; the pushed file must be present.
    const clone = join(cfg.root, 'clone')
    await $`git clone ${remote} ${clone}`.quiet().nothrow()
    expect(existsSync(join(clone, 'content', 'shared.md'))).toBe(true)
    rmSync(cfg.root, { recursive: true, force: true })
  }, GIT_TEST_TIMEOUT_MS)

  test('sync uses a configured remote name after cloning from a URL', async () => {
    const cfg = mkConfig()
    const remote = join(cfg.root, 'remote.git')
    await $`git init --bare -b main ${remote}`.quiet().nothrow()

    const git = createGitStorage({ ...cfg, remote: 'mirror', remoteUrl: remote })
    await git.init()

    const configured = await $`git -C ${cfg.dir} remote get-url mirror`.quiet().nothrow()
    expect(configured.text().trim()).toBe(remote)

    await git.savePage({ path: 'named', title: 'Named', description: '', content: 'hello' })
    const res = await git.sync({ upsert: () => {}, remove: () => {} })
    expect(res.pushed).toBe(true)

    const clone = join(cfg.root, 'clone')
    await $`git clone ${remote} ${clone}`.quiet().nothrow()
    expect(existsSync(join(clone, 'content', 'named.md'))).toBe(true)
    rmSync(cfg.root, { recursive: true, force: true })
  }, GIT_TEST_TIMEOUT_MS)

  test('init clones an existing remote; first sync imports its content', async () => {
    const cfg = mkConfig()
    const remote = join(cfg.root, 'remote.git')
    // Seed a remote that already has a page (as if another instance pushed it).
    const seed = join(cfg.root, 'seed')
    await $`git init -b main ${seed}`.quiet().nothrow()
    mkdirSync(join(seed, 'content'), { recursive: true })
    writeFileSync(join(seed, 'content', 'welcome.md'), '---\ntitle: Welcome\ndescription: w\n---\n\nhi\n')
    await $`git -C ${seed} add -A`.quiet().nothrow()
    await $`git -C ${seed} -c user.name=S -c user.email=s@x commit -m seed`.quiet().nothrow()
    await $`git clone --bare ${seed} ${remote}`.quiet().nothrow()

    // Fresh storage pointed at that remote should clone it on init...
    const git = createGitStorage({ ...cfg, remoteUrl: remote })
    await git.init()
    expect(existsSync(join(cfg.dir, 'content', 'welcome.md'))).toBe(true)

    // ...and the first sync imports the pre-existing remote content into the DB.
    const imported: string[] = []
    const res = await git.sync({ upsert: (p) => imported.push(p), remove: () => {} })
    expect(imported).toContain('welcome')
    expect(res.upserted).toContain('welcome')
    rmSync(cfg.root, { recursive: true, force: true })
  }, GIT_TEST_TIMEOUT_MS)

  test('our own push is NOT re-imported (no loop)', async () => {
    const cfg = mkConfig()
    const git = createGitStorage(cfg)
    await git.init()
    await git.savePage({ path: 'mine', title: 'Mine', description: '', content: 'x' })

    const imported: string[] = []
    const res = await git.sync({ upsert: (p) => imported.push(p), remove: () => {} })
    expect(res.upserted).toHaveLength(0) // marker advanced on our commit
    rmSync(cfg.root, { recursive: true, force: true })
  }, GIT_TEST_TIMEOUT_MS)
})
