import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePageFile } from '@wiki/core'
import { createGitStorage, type GitConfig } from './git.ts'

const mkConfig = (): GitConfig & { root: string } => {
  const root = mkdtempSync(join(tmpdir(), 'ow-git-'))
  return {
    enabled: true,
    dir: join(root, 'repo'),
    branch: 'main',
    remote: null,
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
  })

  test('deletePage removes the file', async () => {
    const cfg = mkConfig()
    const git = createGitStorage(cfg)
    await git.init()
    await git.savePage({ path: 'tmp', title: 'T', description: '', content: 'x' })
    expect(existsSync(join(cfg.dir, 'content', 'tmp.md'))).toBe(true)
    await git.deletePage('tmp')
    expect(existsSync(join(cfg.dir, 'content', 'tmp.md'))).toBe(false)
    rmSync(cfg.root, { recursive: true, force: true })
  })

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
  })

  test('our own push is NOT re-imported (no loop)', async () => {
    const cfg = mkConfig()
    const git = createGitStorage(cfg)
    await git.init()
    await git.savePage({ path: 'mine', title: 'Mine', description: '', content: 'x' })

    const imported: string[] = []
    const res = await git.sync({ upsert: (p) => imported.push(p), remove: () => {} })
    expect(res.upserted).toHaveLength(0) // marker advanced on our commit
    rmSync(cfg.root, { recursive: true, force: true })
  })
})
