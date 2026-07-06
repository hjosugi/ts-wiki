import { describe, expect, test } from 'bun:test'
import {
  can,
  normalizePath,
  renderMarkdown,
  extractPageLinks,
  rewritePageLinks,
  extractCalendarEvents,
  parseIcsEvents,
  calendarEventToFence,
  slugifyHeading,
  toPlainText,
  validatePageInput,
  isOk,
  isErr,
} from './index.ts'

describe('slug', () => {
  test('normalizes a multi-segment path', () => {
    expect(normalizePath('  Docs / Getting Started ')).toBe('docs/getting-started')
  })
  test('keeps unicode (Japanese) letters', () => {
    expect(normalizePath('ガイド/はじめに')).toBe('ガイド/はじめに')
  })
  test('collapses unsafe characters and edge dashes', () => {
    expect(slugifyHeading('Hello, World!! ')).toBe('hello-world')
  })
})

describe('markdown', () => {
  test('renders headings with ids and extracts a TOC', () => {
    const { html, toc } = renderMarkdown('# Title\n\n## Section A\n\ntext')
    expect(html).toContain('id="title"')
    expect(toc).toEqual([
      { id: 'title', text: 'Title', level: 1 },
      { id: 'section-a', text: 'Section A', level: 2 },
    ])
  })
  test('does not pass through raw HTML', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })
  test('toPlainText strips formatting', () => {
    expect(toPlainText('# Hi\n\n**bold** and `code`')).toBe('Hi bold and code')
  })
  test('extracts wiki and markdown page links', () => {
    expect(extractPageLinks('See [[Docs/Intro|intro]] and [Guide](/guide/start?q=1#top).')).toEqual([
      { path: 'docs/intro', label: 'intro', kind: 'wikilink' },
      { path: 'guide/start', label: 'guide/start', kind: 'markdown' },
    ])
  })
  test('rewrites internal page links while preserving labels and anchors', () => {
    expect(
      rewritePageLinks(
        'See [[Docs/Intro|intro]], [Guide](/docs/intro#top), ![Image](/docs/intro.png), and [Site](https://example.com).',
        'docs/intro',
        'docs/start',
      ),
    ).toBe('See [[docs/start|intro]], [Guide](/docs/start#top), ![Image](/docs/intro.png), and [Site](https://example.com).')
  })
  test('ignores external and asset links in page link extraction', () => {
    expect(extractPageLinks('[Site](https://example.com) ![Image](/assets/a.png) [Hash](#part)')).toEqual([])
  })
  test('renders calendar event fences as event cards', () => {
    const { html } = renderMarkdown(`\`\`\`event
title: Product review
start: 2026-06-20 10:00
end: 2026-06-20 10:30
timezone: Asia/Tokyo
location: Zoom
url: https://example.com/meeting
description: Weekly checkpoint
\`\`\``)

    expect(html).toContain('wiki-event-card')
    expect(html).toContain('Product review')
    expect(html).toContain('Google Calendar')
    expect(html).toContain('Download .ics')
    expect(html).toContain('20260620T100000%2F20260620T103000')
  })
  test('extracts calendar events from event fences', () => {
    const events = extractCalendarEvents(`Before
\`\`\`event
title: Planning
start: 2026-07-05
description: Roadmap
\`\`\`
After`, 'team/plan')

    expect(events).toEqual([
      {
        id: 'team/plan:0:planning',
        sourcePath: 'team/plan',
        block: 0,
        title: 'Planning',
        start: '2026-07-05',
        description: 'Roadmap',
      },
    ])
  })
  test('parses ICS events and converts them into event fences', () => {
    const [event] = parseIcsEvents(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Team Sync
DTSTART;TZID=Asia/Tokyo:20260705T103000
DTEND;TZID=Asia/Tokyo:20260705T110000
LOCATION:Zoom
DESCRIPTION:Weekly\\ncheck
END:VEVENT
END:VCALENDAR`)

    expect(event).toEqual({
      title: 'Team Sync',
      start: '2026-07-05 10:30',
      end: '2026-07-05 11:00',
      timezone: 'Asia/Tokyo',
      location: 'Zoom',
      description: 'Weekly\ncheck',
      url: undefined,
    })
    expect(calendarEventToFence(event!)).toContain('title: Team Sync')
  })
  test('renders wiki links as internal page links', () => {
    const { html } = renderMarkdown('See [[Docs/Intro|intro]].')
    expect(html).toContain('href="/docs/intro"')
    expect(html).toContain('data-wiki-link="docs/intro"')
  })
  test('renders safe typed blocks for callouts, embeds, and mermaid source', () => {
    const { html } = renderMarkdown(`\`\`\`callout
type: warning
title: Heads up
**Check** this before deploy.
\`\`\`

\`\`\`embed
url: https://example.com/doc
title: External doc
description: Reference material
\`\`\`

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\``)

    expect(html).toContain('wiki-callout-warning')
    expect(html).toContain('<strong>Check</strong>')
    expect(html).toContain('wiki-embed')
    expect(html).toContain('https://example.com/doc')
    expect(html).toContain('wiki-mermaid')
    expect(html).toContain('A --&gt; B')
  })

  test('renders a generic infobox with title, media, fields, and body', () => {
    const { html } = renderMarkdown(`\`\`\`infobox
title: Hoshino Meguru
image: /assets/hoshino.png
caption: Hoshinoi Production
Debut: 2023-04-01
Fan name: Stargazers
Links: [YouTube](https://youtube.com/@x)

First stream was a **karaoke** night.
\`\`\``)

    expect(html).toContain('wiki-infobox')
    expect(html).toContain('wiki-infobox-title')
    expect(html).toContain('Hoshino Meguru')
    expect(html).toContain('src="/assets/hoshino.png"')
    expect(html).toContain('wiki-infobox-caption')
    // Arbitrary field labels are preserved in source order...
    expect(html).toContain('<dt>Debut</dt>')
    expect(html).toContain('<dt>Fan name</dt>')
    // ...and values render inline Markdown (links, emphasis).
    expect(html).toContain('href="https://youtube.com/@x"')
    // The free-form body renders block Markdown.
    expect(html).toContain('<strong>karaoke</strong>')
  })

  test('infobox drops unsafe image URLs; `profile` is an alias', () => {
    const { html } = renderMarkdown(`\`\`\`profile
title: Test
image: javascript:alert(1)
Role: Tester
\`\`\``)

    expect(html).toContain('wiki-infobox')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:alert(1)')
    expect(html).toContain('<dt>Role</dt>')
  })

  test('callout types are open-ended (custom type keeps its class)', () => {
    const { html } = renderMarkdown(`\`\`\`callout
type: spoiler
title: Ending
It was all a dream.
\`\`\``)

    expect(html).toContain('wiki-callout-spoiler')
    expect(html).toContain('Ending')
  })

  test('renders a links/social row with provider detection and labels', () => {
    const { html } = renderMarkdown(`\`\`\`links
[Watch](https://www.youtube.com/@handle)
https://x.com/handle
https://booth.pm/en/items/1
https://example.com/guide
javascript:alert(1)
\`\`\``)

    expect(html).toContain('wiki-links')
    // Explicit label kept; provider class applied from the host.
    expect(html).toContain('wiki-links-youtube')
    expect(html).toContain('>Watch<')
    // Bare URL uses the provider's default label.
    expect(html).toContain('wiki-links-x')
    expect(html).toContain('>X<')
    expect(html).toContain('wiki-links-booth')
    // Unknown host, bare URL → neutral item labelled by hostname.
    expect(html).toContain('>example.com<')
    // Non-http(s) URLs are dropped.
    expect(html).not.toContain('javascript:alert(1)')
  })

  test('`social` is an alias and an all-invalid block renders nothing', () => {
    const withProvider = renderMarkdown('```social\nhttps://twitch.tv/handle\n```').html
    expect(withProvider).toContain('wiki-links-twitch')

    const empty = renderMarkdown('```links\nnot a url\nftp://x\n```').html
    expect(empty).not.toContain('wiki-links')
  })
})

describe('permissions', () => {
  test('anonymous can only read', () => {
    expect(can(null, 'page:read')).toBe(true)
    expect(can(null, 'page:write')).toBe(false)
  })
  test('editor can write but not access admin', () => {
    const editor = { id: '1', role: 'editor' as const }
    expect(can(editor, 'page:write')).toBe(true)
    expect(can(editor, 'admin:access')).toBe(false)
  })
  test('admin can do everything', () => {
    const admin = { id: '1', role: 'admin' as const }
    expect(can(admin, 'admin:access')).toBe(true)
  })
  test('page rules can restrict a group to a path prefix', () => {
    const editor = {
      id: '1',
      role: 'viewer' as const,
      groups: ['team-a'],
      policy: {
        pageRules: [
          {
            subjectType: 'group' as const,
            subjectId: 'team-a',
            action: 'page:update' as const,
            effect: 'allow' as const,
            matcher: 'prefix' as const,
            pattern: 'team-a',
          },
        ],
      },
    }

    expect(can(editor, 'page:update', { path: 'team-a/runbook' })).toBe(true)
    expect(can(editor, 'page:update', { path: 'team-b/runbook' })).toBe(false)
  })
  test('deny wins over allow at the same page-rule specificity', () => {
    const principal = {
      id: '1',
      role: 'editor' as const,
      groups: ['ops'],
      policy: {
        pageRules: [
          {
            subjectType: 'group' as const,
            subjectId: 'ops',
            action: 'page:update' as const,
            effect: 'allow' as const,
            matcher: 'exact' as const,
            pattern: 'ops/secret',
          },
          {
            subjectType: 'group' as const,
            subjectId: 'ops',
            action: 'page:update' as const,
            effect: 'deny' as const,
            matcher: 'exact' as const,
            pattern: 'ops/secret',
          },
        ],
      },
    }

    expect(can(principal, 'page:update', { path: 'ops/secret' })).toBe(false)
  })
})

describe('page validation', () => {
  test('accepts and normalizes valid input', () => {
    const r = validatePageInput({
      path: 'Docs/Intro',
      title: 'Intro',
      content: 'hello world',
      labels: ['Ops Notes', 'ops notes', '日本語'],
      status: 'verified',
      locale: 'JA-JP',
    })
    expect(isOk(r)).toBe(true)
    if (isOk(r)) {
      expect(r.value.path).toBe('docs/intro')
      expect(r.value.description).toBe('hello world')
      expect(r.value.labels).toEqual(['ops-notes', '日本語'])
      expect(r.value.status).toBe('verified')
      expect(r.value.locale).toBe('ja-jp')
    }
  })
  test('rejects empty title', () => {
    const r = validatePageInput({ path: 'x', title: '   ', content: 'y' })
    expect(isErr(r)).toBe(true)
    if (isErr(r)) expect(r.error.field).toBe('title')
  })
  test('rejects empty path', () => {
    const r = validatePageInput({ path: '///', title: 'T', content: 'y' })
    expect(isErr(r)).toBe(true)
    if (isErr(r)) expect(r.error.field).toBe('path')
  })
})
