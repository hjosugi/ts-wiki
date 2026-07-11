import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import unoConfig from './uno.config'

export default defineConfig({
  base: '/ui/',
  plugins: [vue(), UnoCSS({ ...unoConfig, configFile: false })],
  resolve: {
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@lezer/common',
    ],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Consume the core package as TypeScript source so Vite transpiles it.
      '@kawaii-wiki/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // 5180 (not Vite's default 5173) to avoid colliding with other local dev
    // servers; strictPort:false so it falls back to the next free port anyway.
    port: 5180,
    strictPort: false,
  },
  build: {
    chunkSizeWarningLimit: 3500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined
          if (
            id.includes('/@codemirror/')
            || id.includes('/codemirror/')
            || id.includes('/y-codemirror.next/')
          ) return 'vendor-editor'
          if (
            id.includes('/yjs/')
            || id.includes('/y-protocols/')
            || id.includes('/y-websocket/')
            || id.includes('/lib0/')
          ) return 'vendor-collab'
          if (id.includes('/mermaid/')) return 'vendor-mermaid'
          if (id.includes('/katex/') || id.includes('/markdown-it-katex/')) return 'vendor-katex'
          if (id.includes('/highlight.js/')) return 'vendor-highlight'
          if (id.includes('/markdown-it')) return 'vendor-markdown'
          if (id.includes('/@simplewebauthn/')) return 'vendor-auth'
          if (
            id.includes('/@vue/')
            || id.includes('/vue/')
            || id.includes('/vue-router/')
            || id.includes('/pinia/')
          ) return 'vendor-vue'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
