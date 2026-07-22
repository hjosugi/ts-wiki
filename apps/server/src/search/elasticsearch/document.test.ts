import { describe, expect, test } from 'bun:test'
import { buildPageDocument, type PageIndexSource } from './document.ts'

const source = (over: Partial<PageIndexSource> = {}): PageIndexSource => ({
  path: 'docs/x',
  title: 'Title',
  description: 'Desc',
  content: '# Heading\n\n**bold** body',
  spaceKey: 'main',
  status: 'verified',
  locale: 'en',
  authorId: 'u1',
  authorName: 'Alice',
  labels: '["a","b"]',
  icon: '📄',
  coverUrl: '',
  coverPosition: 'center',
  updatedAt: 5,
  comments: 'a comment',
  assets: 'diagram.png art',
  ...over,
})

describe('buildPageDocument', () => {
  test('maps fields, plain-texts markdown, and parses labels', () => {
    const doc = buildPageDocument(source())
    expect(doc.title).toBe('Title')
    expect(doc.content).not.toContain('#')
    expect(doc.content).not.toContain('**')
    expect(doc.content).toContain('body')
    expect(doc.labels).toEqual(['a', 'b'])
    expect(doc.updatedAt).toBe(5)
    expect(doc.comments).toBe('a comment')
  })

  test('tolerates malformed or non-string labels', () => {
    expect(buildPageDocument(source({ labels: 'not json' })).labels).toEqual([])
    expect(buildPageDocument(source({ labels: '[1, "x", null]' })).labels).toEqual(['x'])
  })
})
