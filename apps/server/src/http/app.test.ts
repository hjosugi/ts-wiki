import { afterEach, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Env } from '../env.ts'
import { createDb, type DB } from '../db/client.ts'
import { ASSET_MAX_BYTES } from '../services/assets.ts'
import { createApp, type App } from './app.ts'

const fixtures: Array<{ db: DB; dataDir: string }> = []
const HTTP_TEST_TIMEOUT_MS = 15_000

const png1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ),
)

const testEnv = (dataDir: string, cors: Env['cors'] = { origins: null }): Env => ({
  port: 0,
  databasePath: ':memory:',
  dataDir,
  jwtSecret: 'test-secret',
  cors,
  git: {
    enabled: false,
    dir: join(dataDir, 'repo'),
    branch: 'main',
    remote: null,
    remoteUrl: null,
    authorName: 'Test',
    authorEmail: 'test@localhost',
    syncIntervalMs: 0,
  },
  realtime: {
    eventBus: 'memory',
    instanceId: 'test-instance',
    pollIntervalMs: 50,
  },
})

const createFixture = (cors?: Env['cors']): { app: App; db: DB; dataDir: string } => {
  const dataDir = mkdtempSync(join(tmpdir(), 'open-wiki-test-'))
  mkdirSync(join(dataDir, 'assets'), { recursive: true })
  const db = createDb(':memory:')
  fixtures.push({ db, dataDir })
  return { app: createApp({ db, env: testEnv(dataDir, cors) }), db, dataDir }
}

const jsonRequest = (path: string, body: unknown, token?: string): Request =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

const register = async (app: App, email: string): Promise<{ token: string; user: { role: string } }> => {
  const response = await app.handle(
    jsonRequest('/api/auth/register', { email, name: email.split('@')[0], password: 'password' }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.db.$client.close()
    rmSync(fixture.dataDir, { recursive: true, force: true })
  }
})

describe('http app auth', () => {
  test('register bootstraps only the first account as admin', async () => {
    const { app } = createFixture()

    const first = await register(app, 'admin@example.com')
    const second = await register(app, 'viewer@example.com')

    expect(first.user.role).toBe('admin')
    expect(second.user.role).toBe('viewer')
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app CORS', () => {
  test('allows arbitrary origins in local/dev mode', async () => {
    const { app } = createFixture()

    const response = await app.handle(
      new Request('http://localhost/api/health', {
        headers: { Origin: 'http://localhost:5173' },
      }),
    )

    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  }, HTTP_TEST_TIMEOUT_MS)

  test('only reflects configured CORS origins', async () => {
    const { app } = createFixture({ origins: ['https://wiki.example.com'] })

    const allowed = await app.handle(
      new Request('http://localhost/api/health', {
        headers: { Origin: 'https://wiki.example.com' },
      }),
    )
    const blocked = await app.handle(
      new Request('http://localhost/api/health', {
        headers: { Origin: 'https://blocked.example.com' },
      }),
    )

    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://wiki.example.com')
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull()
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app assets', () => {
  test('accepts small allowed images and serves them with safe headers', async () => {
    const { app, dataDir } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    const form = new FormData()
    form.set('file', new File([png1x1], 'avatar.png', { type: 'image/png' }))

    const response = await app.handle(
      new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { filename: string; url: string }
    expect(body.filename).toBe('avatar.png')
    expect(body.url).toMatch(/^\/assets\/.+-avatar\.png$/)
    expect(existsSync(join(dataDir, body.url))).toBe(true)

    const assetResponse = await app.handle(new Request(`http://localhost${body.url}`))
    expect(assetResponse.status).toBe(200)
    expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff')
    expect(assetResponse.headers.get('content-disposition')).toBe('inline')
    expect((await assetResponse.arrayBuffer()).byteLength).toBe(png1x1.byteLength)
  }, HTTP_TEST_TIMEOUT_MS)

  test('rejects disallowed or oversized uploads', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const html = new FormData()
    html.set('file', new File(['<script>alert(1)</script>'], 'x.html', { type: 'text/html' }))
    const htmlResponse = await app.handle(
      new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: html,
      }),
    )
    expect(htmlResponse.status).toBe(422)

    const large = new FormData()
    large.set('file', new File([new Uint8Array(ASSET_MAX_BYTES + 1)], 'huge.png', { type: 'image/png' }))
    const largeResponse = await app.handle(
      new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: large,
      }),
    )
    expect(largeResponse.status).toBe(422)
  }, HTTP_TEST_TIMEOUT_MS)
})
