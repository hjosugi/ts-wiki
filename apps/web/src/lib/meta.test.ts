import { beforeEach, describe, expect, test } from 'vitest'
import type { Page } from './api'
import { setPageMeta } from './meta'

const makePage = (overrides: Partial<Page> = {}): Page => ({
  id: 'page-1',
  path: 'docs/seo',
  title: 'SEO page',
  description: 'Page description',
  content: '',
  renderedHtml: '',
  toc: '[]',
  contentType: 'markdown',
  lifecycle: 'active',
  status: 'verified',
  labels: '[]',
  ownerId: null,
  reviewAt: null,
  navOrder: null,
  pinned: false,
  spaceKey: 'default',
  locale: 'en',
  authorId: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

describe('setPageMeta', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta property="og:site_name" content="Docs Wiki" />'
    document.title = ''
  })

  test('updates page title, descriptions, and social image tags', () => {
    setPageMeta(makePage({
      title: 'SEO & Title',
      renderedHtml: '<p>Intro</p><img src="/assets/cover.png" alt="Cover">',
    }))

    expect(document.title).toBe('SEO & Title · Docs Wiki')
    expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe('Page description')
    expect(document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content).toBe('SEO & Title · Docs Wiki')
    expect(document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content).toBe(`${window.location.origin}/docs/seo`)
    expect(document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content).toBe(`${window.location.origin}/assets/cover.png`)
    expect(document.querySelector<HTMLMetaElement>('meta[name="twitter:card"]')?.content).toBe('summary_large_image')
  })

  test('removes stale social image tags when the next page has no image', () => {
    setPageMeta(makePage({ renderedHtml: '<img src="/assets/cover.png" alt="Cover">' }))
    setPageMeta(makePage({ path: 'docs/plain', renderedHtml: '<p>No image</p>' }))

    expect(document.querySelector('meta[property="og:image"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:image"]')).toBeNull()
    expect(document.querySelector<HTMLMetaElement>('meta[name="twitter:card"]')?.content).toBe('summary')
  })
})
