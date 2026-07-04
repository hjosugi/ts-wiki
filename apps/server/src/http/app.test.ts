import { afterEach, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Env } from '../env.ts'
import { createDb, type DB } from '../db/client.ts'
import { ASSET_MAX_BYTES } from '../services/assets.ts'
import type { LogEvent, StructuredLogger } from '../observability/logging.ts'
import { createApp, type App } from './app.ts'

const fixtures: Array<{ db: DB; dataDir: string; app: App }> = []
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
  webDistDir: join(dataDir, 'web-dist'),
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

const noopLogger: StructuredLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

const captureLogger = (): { logger: StructuredLogger; events: LogEvent[] } => {
  const events: LogEvent[] = []
  return {
    events,
    logger: {
      info: (event) => events.push(event),
      warn: (event) => events.push(event),
      error: (event) => events.push(event),
    },
  }
}

const createFixture = (
  cors?: Env['cors'],
  options: { webDist?: boolean; logger?: StructuredLogger } = {},
): { app: App; db: DB; dataDir: string } => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ts-wiki-test-'))
  mkdirSync(join(dataDir, 'assets'), { recursive: true })
  if (options.webDist) {
    mkdirSync(join(dataDir, 'web-dist', 'assets'), { recursive: true })
    writeFileSync(join(dataDir, 'web-dist', 'index.html'), '<!doctype html><div id="app"></div>')
    writeFileSync(join(dataDir, 'web-dist', 'assets', 'app.js'), 'console.log("ts-wiki")')
  }
  const db = createDb(':memory:')
  const app = createApp({ db, env: testEnv(dataDir, cors), logger: options.logger ?? noopLogger })
  fixtures.push({ db, dataDir, app })
  return { app, db, dataDir }
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

const createPage = async (app: App, token: string, path: string, content = 'hello'): Promise<void> => {
  const response = await app.handle(
    jsonRequest('/api/pages', { path, title: path, content }, token),
  )
  expect(response.status).toBe(200)
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.app.server?.stop(true)
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

  test('rate limits repeated login attempts by client IP', async () => {
    const { app } = createFixture()

    for (let i = 0; i < 10; i += 1) {
      const response = await app.handle(
        jsonRequest('/api/auth/login', { email: 'nobody@example.com', password: 'wrong' }),
      )
      expect(response.status).toBe(401)
    }

    const limited = await app.handle(
      jsonRequest('/api/auth/login', { email: 'nobody@example.com', password: 'wrong' }),
    )
    expect(limited.status).toBe(429)
  }, HTTP_TEST_TIMEOUT_MS)

  test('rate limits repeated registration attempts by client IP', async () => {
    const { app } = createFixture()

    for (let i = 0; i < 10; i += 1) {
      const response = await app.handle(
        jsonRequest('/api/auth/register', { email: 'same@example.com', name: 'Same', password: 'password' }),
      )
      expect([200, 409]).toContain(response.status)
    }

    const limited = await app.handle(
      jsonRequest('/api/auth/register', { email: 'same@example.com', name: 'Same', password: 'password' }),
    )
    expect(limited.status).toBe(429)
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

describe('http app authorization', () => {
  test('admin routes reject anonymous and viewer principals', async () => {
    const { app } = createFixture()
    await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')

    const anonymous = await app.handle(new Request('http://localhost/api/admin/stats'))
    const viewed = await app.handle(
      new Request('http://localhost/api/admin/stats', {
        headers: { authorization: `Bearer ${viewer.token}` },
      }),
    )

    expect(anonymous.status).toBe(403)
    expect(viewed.status).toBe(403)
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app structured logging', () => {
  test('emits structured request and audit events for writes', async () => {
    const { logger, events } = captureLogger()
    const { app } = createFixture(undefined, { logger })
    const { token } = await register(app, 'admin@example.com')

    await createPage(app, token, 'docs/logs', 'hello')

    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'auth.register' }))
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'audit', action: 'page.create', path: 'docs/logs' }),
    )
    expect(events).toContainEqual(expect.objectContaining({ type: 'request', method: 'POST', path: '/api/pages', status: 200 }))
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app realtime', () => {
  test('SSE events require a readable principal token', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const anonymous = await app.handle(new Request('http://localhost/api/events'))
    expect(anonymous.status).toBe(401)

    const response = await app.handle(new Request(`http://localhost/api/events?token=${token}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('connected')
    await reader.cancel()
  }, HTTP_TEST_TIMEOUT_MS)

  test('presence WebSocket opens and broadcasts the current viewer list', async () => {
    const { app } = createFixture()
    app.listen(0)
    const base = app.server!.url.href.replace(/^http/, 'ws')
    const ws = new WebSocket(`${base}api/presence?path=${encodeURIComponent('docs/ws')}&name=Ada`)

    const message = await new Promise<MessageEvent>((resolve, reject) => {
      ws.onmessage = (event) => resolve(event)
      ws.onerror = () => reject(new Error('presence socket failed'))
    })
    const payload = JSON.parse(String(message.data)) as { type: string; path: string; viewers: Array<{ name: string }> }
    expect(payload.type).toBe('presence')
    expect(payload.path).toBe('docs/ws')
    expect(payload.viewers.some((viewer) => viewer.name === 'Ada')).toBe(true)

    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve()
      ws.close()
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('collab WebSocket rejects anonymous/viewer clients and accepts editors', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')
    await createPage(app, token, 'docs/ws', 'seed')
    app.listen(0)
    const base = app.server!.url.href.replace(/^http/, 'ws')

    const closed = await new Promise<CloseEvent>((resolve) => {
      const ws = new WebSocket(`${base}api/collab/${encodeURIComponent('docs/ws')}`)
      ws.onclose = (event) => resolve(event)
    })
    expect(closed.code).toBe(1008)

    const viewerClosed = await new Promise<CloseEvent>((resolve) => {
      const ws = new WebSocket(`${base}api/collab/${encodeURIComponent('docs/ws')}?token=${viewer.token}`)
      ws.onclose = (event) => resolve(event)
    })
    expect(viewerClosed.code).toBe(1008)

    const authed = new WebSocket(`${base}api/collab/${encodeURIComponent('docs/ws')}?token=${token}`)
    await new Promise<void>((resolve, reject) => {
      authed.onopen = () => resolve()
      authed.onerror = () => reject(new Error('authenticated collab socket failed'))
    })
    expect(authed.readyState).toBe(WebSocket.OPEN)
    await new Promise<void>((resolve) => {
      authed.onclose = () => resolve()
      authed.close()
    })
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app page utilities', () => {
  test('exposes history, backlinks, and event index routes', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/target', 'hello')
    await createPage(app, token, 'docs/source', 'See [[Docs/Target]].\n\n```event\ntitle: Sync\nstart: 2026-07-05\n```')

    const update = await app.handle(
      new Request('http://localhost/api/page?path=docs/target', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: 'hello again' }),
      }),
    )
    expect(update.status).toBe(200)

    const history = await app.handle(new Request('http://localhost/api/page/history?path=docs/target'))
    expect(history.status).toBe(200)
    expect((await history.json()).revisions.length).toBeGreaterThan(1)

    const backlinks = await app.handle(new Request('http://localhost/api/page/backlinks?path=docs/target'))
    expect(backlinks.status).toBe(200)
    expect((await backlinks.json()).backlinks).toContainEqual(
      expect.objectContaining({ path: 'docs/source', kind: 'wikilink' }),
    )

    const events = await app.handle(new Request('http://localhost/api/events/index'))
    expect(events.status).toBe(200)
    expect((await events.json()).events).toContainEqual(
      expect.objectContaining({ sourcePath: 'docs/source', title: 'Sync' }),
    )
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

describe('http app web serving', () => {
  test('serves built web assets and falls back to the SPA shell', async () => {
    const { app } = createFixture(undefined, { webDist: true })

    const asset = await app.handle(new Request('http://localhost/ui/assets/app.js'))
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('ts-wiki')

    const ui = await app.handle(new Request('http://localhost/ui/'))
    expect(ui.status).toBe(200)
    expect(await ui.text()).toContain('<div id="app"></div>')

    const route = await app.handle(new Request('http://localhost/docs/readme'))
    expect(route.status).toBe(200)
    expect(await route.text()).toContain('<div id="app"></div>')

    const api = await app.handle(new Request('http://localhost/api/nope'))
    expect(api.status).toBe(404)
  }, HTTP_TEST_TIMEOUT_MS)
})
