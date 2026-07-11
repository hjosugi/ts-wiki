import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4100',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'bun scripts/e2e-server.ts',
    url: 'http://127.0.0.1:4100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
