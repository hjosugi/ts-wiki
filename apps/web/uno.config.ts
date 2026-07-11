import { defineConfig, presetUno, presetTypography } from 'unocss'
import type { Theme } from '@unocss/preset-mini'

const unoConfig = defineConfig({
  presets: [
    // `dark: 'class'` → dark mode is driven by a `.dark` class on <html>, which
    // useTheme() sets from the user's choice (or the OS in system mode).
    presetUno({ dark: 'class' }),
    presetTypography<Theme>(),
  ],
  theme: {
    fontFamily: {
      sans: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace',
    },
  },
  shortcuts: {
    btn: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius)] text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-surface)]',
    // The accent colour comes from the `--accent` CSS variable so the admin
    // "Accent colour" setting can retint every primary surface at runtime.
    'btn-primary': 'btn bg-[var(--c-accent)] text-white hover:bg-[var(--accent-hover)]',
    'btn-ghost': 'btn text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)]',
    'btn-danger': 'btn text-red-600 hover:bg-red-50 dark:hover:bg-red-950',
    input:
      'w-full px-3 py-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] outline-none focus:border-[var(--c-accent)] focus:ring-1 focus:ring-[var(--c-accent)] transition',
    card: 'rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]',
    'link-quiet': 'rounded-sm text-[var(--c-accent)] hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-surface)]',
  },
})

export default unoConfig
