import { defineConfig, presetUno, presetTypography } from 'unocss'

const unoConfig = defineConfig({
  presets: [
    // `dark: 'class'` → dark mode is driven by a `.dark` class on <html>, which
    // useTheme() sets from the user's choice (or the OS in system mode).
    presetUno({ dark: 'class' }),
    presetTypography(),
  ],
  theme: {
    fontFamily: {
      sans: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace',
    },
  },
  shortcuts: {
    btn: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer select-none',
    // The accent colour comes from the `--accent` CSS variable so the admin
    // "Accent colour" setting can retint every primary surface at runtime.
    'btn-primary': 'btn bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
    'btn-ghost': 'btn text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
    'btn-danger': 'btn text-red-600 hover:bg-red-50 dark:hover:bg-red-950',
    input:
      'w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition',
    card: 'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
    'link-quiet': 'text-[var(--accent)] hover:underline underline-offset-2',
  },
})

export default unoConfig
