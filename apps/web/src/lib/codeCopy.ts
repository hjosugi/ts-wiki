import type { Directive } from 'vue'

const LABEL = 'Copy'
const DONE = 'Copied'

/**
 * Add a copy-to-clipboard button to every `<pre>` code block inside `root`.
 * Idempotent: already-enhanced blocks (and non-code diagram blocks) are skipped,
 * so it is safe to re-run whenever rendered content changes.
 */
export function enhanceCodeBlocks(root: HTMLElement): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    if (pre.dataset.copyReady === '1' || pre.classList.contains('wiki-diagram')) continue
    pre.dataset.copyReady = '1'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'wiki-code-copy'
    button.textContent = LABEL
    button.setAttribute('aria-label', 'Copy code to clipboard')
    button.addEventListener('click', () => {
      const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
      void navigator.clipboard?.writeText(code).then(() => {
        button.textContent = DONE
        window.setTimeout(() => {
          button.textContent = LABEL
        }, 1200)
      })
    })
    pre.appendChild(button)
  }
}

/** `v-code-copy` — enhances code blocks on mount and whenever content updates. */
export const vCodeCopy: Directive<HTMLElement> = {
  mounted: (el) => enhanceCodeBlocks(el),
  updated: (el) => enhanceCodeBlocks(el),
}
