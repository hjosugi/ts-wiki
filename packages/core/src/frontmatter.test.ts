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

  test('path ↔ file mapping', () => {
    expect(pageFilePath('docs/intro')).toBe('docs/intro.md')
    expect(filePathToPagePath('content/docs/intro.md')).toBe('docs/intro')
    expect(filePathToPagePath('docs/intro.md')).toBe('docs/intro')
    expect(filePathToPagePath('README.txt')).toBeNull()
  })
})
