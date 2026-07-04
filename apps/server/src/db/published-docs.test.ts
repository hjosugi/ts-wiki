import { describe, expect, test } from 'bun:test'
import { publishedDocPages, rewriteRepoMarkdownLinks } from './published-docs.ts'

describe('published docs', () => {
  test('rewrites repository markdown links to wiki routes', () => {
    expect(rewriteRepoMarkdownLinks('README.md', '[Scripts](docs/DESIGN.md#scripts)')).toBe(
      '[Scripts](/docs/design#scripts)',
    )
    expect(rewriteRepoMarkdownLinks('docs/DESIGN.md', '[README](../README.md) [Handoff](HANDOFF.md)')).toBe(
      '[README](/docs/readme) [Handoff](/docs/handoff)',
    )
    expect(rewriteRepoMarkdownLinks('README.md', '[Web](https://example.com) [Local](#docs)')).toBe(
      '[Web](https://example.com) [Local](#docs)',
    )
  })

  test('builds a docs page set from repository markdown', () => {
    const pages = publishedDocPages()
    const paths = pages.map((page) => page.path)

    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toEqual(
      expect.arrayContaining([
        'docs',
        'docs/readme',
        'docs/design',
        'docs/handoff',
        'docs/packages/core',
        'docs/apps/server',
        'docs/apps/web',
      ]),
    )
    expect(pages.find((page) => page.path === 'docs/readme')?.content).toContain(
      '[docs/DESIGN.md](/docs/design)',
    )
  })
})
