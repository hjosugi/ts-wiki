import { describe, expect, test } from 'vitest'
import { enhanceRenderedMarkdown, rendererForMarkdownFeatures } from './markdownEnhance'

describe('markdown enhancements', () => {
  test('enhances code blocks and content tabs without duplicating controls', () => {
    const renderer = rendererForMarkdownFeatures({ enableMath: false, enableEmoji: true, enableMermaid: false, defaultLocale: 'und', timezone: 'UTC', dateFormat: 'medium' })
    const root = document.createElement('div')
    root.innerHTML = `${renderer.renderMarkdown(`\`\`\`ts
const x = 1
\`\`\`

\`\`\`tabs
## macOS
Use brew.

## Windows
Use winget.
\`\`\``).html}`

    enhanceRenderedMarkdown(root, { enableMath: false, enableEmoji: true, enableMermaid: false, defaultLocale: 'und', timezone: 'UTC', dateFormat: 'medium' })
    expect(root.querySelectorAll('.wiki-code-copy')).toHaveLength(1)
    expect(root.querySelector('[data-wiki-tabs]')?.getAttribute('data-tabs-enhanced')).toBe('1')
    expect(root.querySelectorAll('[role="tabpanel"]')[0]?.hasAttribute('hidden')).toBe(false)
    expect(root.querySelectorAll('[role="tabpanel"]')[1]?.hasAttribute('hidden')).toBe(true)

    enhanceRenderedMarkdown(root, { enableMath: false, enableEmoji: true, enableMermaid: false, defaultLocale: 'und', timezone: 'UTC', dateFormat: 'medium' })
    expect(root.querySelectorAll('.wiki-code-copy')).toHaveLength(1)
  })
})
