import { describe, it, expect } from 'vitest'
import { enhanceCodeBlocks } from './codeCopy'

describe('enhanceCodeBlocks', () => {
  it('adds one copy button per code block and is idempotent', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code>a</code></pre><pre><code>b</code></pre>'

    enhanceCodeBlocks(root)
    expect(root.querySelectorAll('.wiki-code-copy')).toHaveLength(2)

    // Re-running must not add duplicate buttons.
    enhanceCodeBlocks(root)
    expect(root.querySelectorAll('.wiki-code-copy')).toHaveLength(2)
  })

  it('skips diagram blocks', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre class="wiki-diagram wiki-mermaid"><code>graph</code></pre>'
    enhanceCodeBlocks(root)
    expect(root.querySelectorAll('.wiki-code-copy')).toHaveLength(0)
  })
})
