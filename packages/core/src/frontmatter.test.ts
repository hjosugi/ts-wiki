import { describe, test, expect } from 'bun:test'
import {
  serializePageFile,
  parsePageFile,
  pageFilePath,
  filePathToPagePath,
} from './frontmatter.ts'

describe('frontmatter', () => {
  test('round-trips a page through serialize → parse', () => {
    const page = { title: 'Getting Started', description: 'A short guide', content: '# Hi\n\nbody text\n' }
    const file = serializePageFile(page)
    expect(file).toContain('title: Getting Started')
    const parsed = parsePageFile(file)
    expect(parsed.title).toBe(page.title)
    expect(parsed.description).toBe(page.description)
    expect(parsed.content.trim()).toBe(page.content.trim())
  })

  test('quotes values that need it (colons, leading space)', () => {
    const file = serializePageFile({ title: 'A: B', description: '  spaced', content: 'x' })
    expect(parsePageFile(file).title).toBe('A: B')
    expect(parsePageFile(file).description).toBe('  spaced')
  })

  test('parses a hand-written file without frontmatter', () => {
    const parsed = parsePageFile('# Just markdown\n\nno frontmatter')
    expect(parsed.title).toBe('')
    expect(parsed.content).toContain('Just markdown')
  })

  test('path ↔ file mapping normalizes content markdown files', () => {
    expect(pageFilePath('docs/intro')).toBe('docs/intro.md')
    expect(filePathToPagePath('content/docs/intro.md')).toBe('docs/intro')
    expect(filePathToPagePath('content/Docs/Getting Started.md')).toBe('docs/getting-started')
    expect(filePathToPagePath('content/ガイド/はじめに.md')).toBe('ガイド/はじめに')
  })

  test('file path mapping rejects non-content and unsafe paths', () => {
    const invalid = [
      'docs/intro.md',
      'README.md',
      'content.md',
      'content/README.txt',
      'content/.md',
      'content/docs/.md',
      'content//intro.md',
      'content/./intro.md',
      'content/../intro.md',
      'content/docs/../../secret.md',
      'content/.../intro.md',
      'content/docs/---.md',
      '../content/intro.md',
      '/content/intro.md',
      'C:/content/intro.md',
      'content\\docs\\intro.md',
      'content/docs/..%2Fsecret.md',
      'content/docs/%5Csecret.md',
      ' content/docs/intro.md',
      'content/docs/intro.md ',
      'README.txt',
    ]

    for (const file of invalid) {
      expect(filePathToPagePath(file)).toBeNull()
    }
  })
})
