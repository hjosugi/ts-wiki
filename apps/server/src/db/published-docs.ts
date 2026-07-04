import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PageInput } from '@wiki/core'

interface SourceDoc {
  readonly sourcePath: string
  readonly wikiPath: string
  readonly title: string
  readonly description: string
}

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))

const sourceDocs: readonly SourceDoc[] = [
  {
    sourcePath: 'README.md',
    wikiPath: 'docs/readme',
    title: 'open-wiki Overview',
    description: 'Project overview, quick start, and documentation map.',
  },
  {
    sourcePath: 'docs/DESIGN.md',
    wikiPath: 'docs/design',
    title: 'Design & Architecture',
    description: 'Architecture, tradeoffs, save/search behavior, multi-instance mode, and scripts.',
  },
  {
    sourcePath: 'docs/HANDOFF.md',
    wikiPath: 'docs/handoff',
    title: 'Handoff / 引き継ぎ資料',
    description: 'Implementation status, conventions, roadmap, gotchas, and extension recipes.',
  },
  {
    sourcePath: 'packages/core/README.md',
    wikiPath: 'docs/packages/core',
    title: '@wiki/core',
    description: 'Pure TypeScript domain package shared by the server and web app.',
  },
  {
    sourcePath: 'apps/server/README.md',
    wikiPath: 'docs/apps/server',
    title: '@wiki/server',
    description: 'Bun + Elysia API server guide.',
  },
  {
    sourcePath: 'apps/web/README.md',
    wikiPath: 'docs/apps/web',
    title: '@wiki/web',
    description: 'Vue 3 + Vite front end guide.',
  },
]

const sourceToWikiPath = new Map(sourceDocs.map((doc) => [doc.sourcePath, doc.wikiPath]))

const normalizeSourcePath = (path: string): string => path.replaceAll('\\', '/').replace(/^\.\//, '')

const splitLinkTarget = (target: string): { path: string; hash: string } => {
  const hashIndex = target.indexOf('#')
  if (hashIndex === -1) return { path: target, hash: '' }
  return { path: target.slice(0, hashIndex), hash: target.slice(hashIndex) }
}

const resolveRepoLink = (fromSourcePath: string, target: string): string | null => {
  if (
    target.startsWith('#') ||
    target.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  ) {
    return null
  }

  const { path, hash } = splitLinkTarget(target)
  if (!path.endsWith('.md')) return null

  const abs = resolve(repoRoot, dirname(fromSourcePath), path)
  const sourcePath = normalizeSourcePath(relative(repoRoot, abs))
  const wikiPath = sourceToWikiPath.get(sourcePath)
  return wikiPath ? `/${wikiPath}${hash}` : null
}

export const rewriteRepoMarkdownLinks = (sourcePath: string, markdown: string): string =>
  markdown.replace(/(!?\[[^\]\n]+\]\()([^)\s]+)(\))/g, (match, prefix: string, target: string, suffix: string) => {
    const rewritten = resolveRepoLink(sourcePath, target)
    return rewritten ? `${prefix}${rewritten}${suffix}` : match
  })

const readSourceDoc = (doc: SourceDoc): PageInput => {
  const raw = readFileSync(resolve(repoRoot, doc.sourcePath), 'utf8')
  return {
    path: doc.wikiPath,
    title: doc.title,
    description: doc.description,
    content: rewriteRepoMarkdownLinks(doc.sourcePath, raw),
  }
}

const docsIndex = (): PageInput => ({
  path: 'docs',
  title: 'open-wiki Docs',
  description: 'open-wiki documentation published as wiki pages.',
  content: `# open-wiki Docs

This documentation is published inside open-wiki itself. Source Markdown lives in the repository; the wiki stores rendered, searchable pages.

## Start here

| Page | Source |
| --- | --- |
| [Overview](/docs/readme) | \`README.md\` |
| [Design & Architecture](/docs/design) | \`docs/DESIGN.md\` |
| [Handoff / 引き継ぎ資料](/docs/handoff) | \`docs/HANDOFF.md\` |

## Package guides

- [@wiki/core](/docs/packages/core)
- [@wiki/server](/docs/apps/server)
- [@wiki/web](/docs/apps/web)

## App guides

- [Getting Started](/docs/getting-started)
- [Markdown Guide](/docs/markdown-guide)
`,
})

export const publishedDocPages = (): PageInput[] => [docsIndex(), ...sourceDocs.map(readSourceDoc)]
