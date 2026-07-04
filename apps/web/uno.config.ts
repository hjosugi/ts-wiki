import { defineConfig, presetUno, presetTypography } from 'unocss'

const unoConfig = defineConfig({
  presets: [
    // `dark: 'media'` → dark mode follows the OS preference, no toggle needed.
    presetUno({ dark: 'media' }),
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
    'btn-primary': 'btn bg-violet-600 text-white hover:bg-violet-700',
    'btn-ghost': 'btn text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
    'btn-danger': 'btn text-red-600 hover:bg-red-50 dark:hover:bg-red-950',
    input:
      'w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition',
    card: 'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
    'link-quiet': 'text-violet-600 dark:text-violet-400 hover:underline underline-offset-2',
  },
})

export default unoConfig
