import { afterEach, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Env } from '../env.ts'
import { createDb, type DB } from '../db/client.ts'
import { ASSET_MAX_BYTES, safeAssetFilename } from '../services/assets.ts'
import { totpCode } from '../services/auth.ts'
import type { WebhookFetcher, WebhookPayload } from '../services/webhooks.ts'
import type { AssetStorage } from '../storage/assets.ts'
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
  database: { driver: 'sqlite', path: ':memory:' },
  databasePath: ':memory:',
  dataDir,
  webDistDir: join(dataDir, 'web-dist'),
  jwtSecret: 'test-secret',
  trustProxyHeaders: false,
  cors,
  auth: {
    siteName: 'ts-wiki-test',
    publicOrigin: 'http://localhost',
    passkeyRpId: 'localhost',
    tokenTtlSeconds: 30 * 24 * 60 * 60,
    registration: 'open',
    privateWiki: false,
    oidcProviders: [],
  },
  search: {
    ftsTokenizer: 'unicode61',
  },
  assetUpload: {
    maxBytes: ASSET_MAX_BYTES,
  },
  assetStorage: {
    type: 'local',
    dataDir,
    publicBaseUrl: null,
  },
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
  options: {
    webDist?: boolean
    logger?: StructuredLogger
    assetStorage?: AssetStorage
    webhookFetcher?: WebhookFetcher
    env?: (env: Env) => Env
  } = {},
): { app: App; db: DB; dataDir: string } => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ts-wiki-test-'))
  mkdirSync(join(dataDir, 'assets'), { recursive: true })
  if (options.webDist) {
    mkdirSync(join(dataDir, 'web-dist', 'assets'), { recursive: true })
    writeFileSync(join(dataDir, 'web-dist', 'index.html'), '<!doctype html><div id="app"></div>')
    writeFileSync(join(dataDir, 'web-dist', 'assets', 'app.js'), 'console.log("ts-wiki")')
  }
  const db = createDb(':memory:')
  const env = options.env?.(testEnv(dataDir, cors)) ?? testEnv(dataDir, cors)
  const app = createApp({
    db,
    env,
    logger: options.logger ?? noopLogger,
    assetStorage: options.assetStorage,
    webhookFetcher: options.webhookFetcher,
  })
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

const register = async (app: App, email: string): Promise<{ token: string; user: { id: string; role: string } }> => {
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

const tableCount = (db: DB, table: string): number =>
  (db.$client.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count

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

  test('ignores spoofed forwarded headers for rate-limit keys by default', async () => {
    const { app } = createFixture()

    for (let i = 0; i < 10; i += 1) {
      const response = await app.handle(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `203.0.113.${i}`,
          },
          body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }),
        }),
      )
      expect(response.status).toBe(401)
    }

    const limited = await app.handle(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.200',
        },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }),
      }),
    )
    expect(limited.status).toBe(429)
  }, HTTP_TEST_TIMEOUT_MS)

  test('TOTP can be enabled and is then required at login', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const setup = await app.handle(
      new Request('http://localhost/api/auth/totp/setup', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(setup.status).toBe(200)
    const setupBody = (await setup.json()) as { secret: string; otpauthUrl: string }
    expect(setupBody.otpauthUrl).toContain('otpauth://totp/')

    const code = totpCode(setupBody.secret)
    const enabled = await app.handle(
      jsonRequest('/api/auth/totp/enable', { code }, token),
    )
    expect(enabled.status).toBe(200)
    expect((await enabled.json()).user.totpEnabled).toBe(true)

    const missingCode = await app.handle(
      jsonRequest('/api/auth/login', { email: 'admin@example.com', password: 'password' }),
    )
    expect(missingCode.status).toBe(401)

    const loggedIn = await app.handle(
      jsonRequest('/api/auth/login', { email: 'admin@example.com', password: 'password', totpCode: code }),
    )
    expect(loggedIn.status).toBe(200)
    expect((await loggedIn.json()).user.totpEnabled).toBe(true)
  }, HTTP_TEST_TIMEOUT_MS)

  test('passkey routes issue WebAuthn options and reject invalid assertions', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const registrationOptions = await app.handle(
      new Request('http://localhost/api/auth/passkeys/register/options', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(registrationOptions.status).toBe(200)
    const registrationBody = await registrationOptions.json()
    expect(registrationBody.options.rp.id).toBe('localhost')
    expect(registrationBody.options.user.name).toBe('admin@example.com')

    const loginOptions = await app.handle(
      jsonRequest('/api/auth/passkeys/login/options', { email: 'admin@example.com' }),
    )
    expect(loginOptions.status).toBe(200)
    const loginBody = await loginOptions.json()
    expect(typeof loginBody.options.challenge).toBe('string')

    const invalidVerify = await app.handle(
      jsonRequest('/api/auth/passkeys/login/verify', {
        response: {
          id: 'missing',
          response: {
            clientDataJSON: Buffer.from(JSON.stringify({ challenge: loginBody.options.challenge })).toString('base64url'),
          },
        },
      }),
    )
    expect(invalidVerify.status).toBe(401)
  }, HTTP_TEST_TIMEOUT_MS)

  test('users can update profile and rotate their own password with audit logs', async () => {
    const { logger, events } = captureLogger()
    const { app } = createFixture(undefined, { logger })
    const { token } = await register(app, 'admin@example.com')

    const profile = await app.handle(
      new Request('http://localhost/api/auth/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'Ada Admin' }),
      }),
    )
    expect(profile.status).toBe(200)
    expect((await profile.json()).user.name).toBe('Ada Admin')

    const password = await app.handle(
      new Request('http://localhost/api/auth/password', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: 'password', newPassword: 'new-password' }),
      }),
    )
    expect(password.status).toBe(200)

    const oldToken = await app.handle(new Request('http://localhost/api/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(oldToken.status).toBe(401)

    const oldPassword = await app.handle(
      jsonRequest('/api/auth/login', { email: 'admin@example.com', password: 'password' }),
    )
    expect(oldPassword.status).toBe(401)

    const newPassword = await app.handle(
      jsonRequest('/api/auth/login', { email: 'admin@example.com', password: 'new-password' }),
    )
    expect(newPassword.status).toBe(200)
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'auth.profile.update' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'auth.password.change' }))
  }, HTTP_TEST_TIMEOUT_MS)

  test('admin reset/deactivate invalidates sessions and demoted admins lose admin access', async () => {
    const { logger, events } = captureLogger()
    const { app } = createFixture(undefined, { logger })
    const admin = await register(app, 'admin@example.com')
    const user = await register(app, 'user@example.com')

    const promoted = await app.handle(
      new Request('http://localhost/api/admin/users/role', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ userId: user.user.id, role: 'admin' }),
      }),
    )
    expect(promoted.status).toBe(200)

    const promotedStats = await app.handle(new Request('http://localhost/api/admin/stats', {
      headers: { authorization: `Bearer ${user.token}` },
    }))
    expect(promotedStats.status).toBe(200)

    const demoted = await app.handle(
      new Request('http://localhost/api/admin/users/role', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ userId: user.user.id, role: 'viewer' }),
      }),
    )
    expect(demoted.status).toBe(200)
    const demotedStats = await app.handle(new Request('http://localhost/api/admin/stats', {
      headers: { authorization: `Bearer ${user.token}` },
    }))
    expect(demotedStats.status).toBe(403)

    const reset = await app.handle(
      new Request('http://localhost/api/admin/users/password', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ userId: user.user.id, password: 'reset-password' }),
      }),
    )
    expect(reset.status).toBe(200)
    const resetLogin = await app.handle(
      jsonRequest('/api/auth/login', { email: 'user@example.com', password: 'reset-password' }),
    )
    expect(resetLogin.status).toBe(200)
    const resetToken = (await resetLogin.json()).token as string

    const deactivated = await app.handle(
      new Request('http://localhost/api/admin/users/deactivate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ userId: user.user.id }),
      }),
    )
    expect(deactivated.status).toBe(200)
    expect((await deactivated.json()).user.disabledAt).toEqual(expect.any(Number))

    const existingSession = await app.handle(new Request('http://localhost/api/auth/me', {
      headers: { authorization: `Bearer ${resetToken}` },
    }))
    expect(existingSession.status).toBe(401)
    const deactivatedLogin = await app.handle(
      jsonRequest('/api/auth/login', { email: 'user@example.com', password: 'reset-password' }),
    )
    expect(deactivatedLogin.status).toBe(401)
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'admin.user.password.reset' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'admin.user.deactivate' }))
  }, HTTP_TEST_TIMEOUT_MS)

  test('registration can be disabled while first-admin bootstrap still works', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, auth: { ...env.auth, registration: 'off' } }),
    })

    const first = await register(app, 'admin@example.com')
    expect(first.user.role).toBe('admin')

    const second = await app.handle(
      jsonRequest('/api/auth/register', { email: 'viewer@example.com', name: 'Viewer', password: 'password' }),
    )
    expect(second.status).toBe(403)

    const settings = await app.handle(new Request('http://localhost/api/settings/public'))
    expect((await settings.json()).registration).toBe('off')
  }, HTTP_TEST_TIMEOUT_MS)

  test('private wiki requires a principal for page read routes and realtime', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, auth: { ...env.auth, privateWiki: true } }),
    })
    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/private', 'secret')

    expect((await app.handle(new Request('http://localhost/api/pages'))).status).toBe(401)
    expect((await app.handle(new Request('http://localhost/api/search?q=secret'))).status).toBe(401)
    expect((await app.handle(new Request('http://localhost/api/events'))).status).toBe(401)
    expect((await app.handle(new Request('http://localhost/api/page?path=docs/private'))).status).toBe(401)

    const authed = await app.handle(new Request('http://localhost/api/page?path=docs/private', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(authed.status).toBe(200)
    expect((await authed.json()).page.path).toBe('docs/private')
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

  test('group page rules can grant a viewer write access only under a prefix', async () => {
    const { app } = createFixture()
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')

    const group = await app.handle(
      jsonRequest('/api/admin/groups', { key: 'team-a', name: 'Team A' }, admin.token),
    )
    expect(group.status).toBe(200)

    const membership = await app.handle(
      jsonRequest('/api/admin/groups/members', { userId: viewer.user.id, groupKey: 'team-a' }, admin.token),
    )
    expect(membership.status).toBe(200)

    for (const action of ['page:create', 'page:update']) {
      const rule = await app.handle(
        jsonRequest('/api/admin/page-rules', {
          subjectType: 'group',
          subjectId: 'team-a',
          action,
          effect: 'allow',
          matcher: 'prefix',
          pattern: 'team-a',
        }, admin.token),
      )
      expect(rule.status).toBe(200)
    }

    const allowed = await app.handle(
      jsonRequest('/api/pages', { path: 'team-a/runbook', title: 'Runbook', content: 'ok' }, viewer.token),
    )
    expect(allowed.status).toBe(200)

    const denied = await app.handle(
      jsonRequest('/api/pages', { path: 'team-b/runbook', title: 'Runbook', content: 'no' }, viewer.token),
    )
    expect(denied.status).toBe(403)
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app settings', () => {
  test('exposes safe public settings and lets admins update them', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const defaults = await app.handle(new Request('http://localhost/api/settings/public'))
    expect(defaults.status).toBe(200)
    expect(await defaults.json()).toMatchObject({ siteTitle: 'ts-wiki', accentColor: '#7c3aed' })

    const updated = await app.handle(
      new Request('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          siteTitle: 'Docs',
          accentColor: '#2563eb',
          theme: 'system',
          navLinks: [{ label: 'Home', url: '/' }],
        }),
      }),
    )
    expect(updated.status).toBe(200)

    const publicSettings = await app.handle(new Request('http://localhost/api/settings/public'))
    expect(await publicSettings.json()).toMatchObject({
      siteTitle: 'Docs',
      accentColor: '#2563eb',
      navLinks: [{ label: 'Home', url: '/' }],
    })
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app automations and webhooks', () => {
  test('admin webhooks sign versioned page events without exposing secrets', async () => {
    const calls: Array<{ url: string; body: string; headers: Headers }> = []
    const fetcher: WebhookFetcher = async (url, init) => {
      calls.push({ url, body: String(init.body), headers: new Headers(init.headers) })
      return new Response('accepted', { status: 202 })
    }
    const { app } = createFixture(undefined, { webhookFetcher: fetcher })
    const { token } = await register(app, 'admin@example.com')
    const secret = 'super-secret'

    const created = await app.handle(
      jsonRequest(
        '/api/admin/webhooks',
        {
          name: 'Deploy hook',
          targetUrl: 'https://hooks.example.com/wiki',
          secret,
          eventTypes: ['page.created'],
        },
        token,
      ),
    )
    expect(created.status).toBe(200)
    expect(await created.text()).not.toContain(secret)

    const listed = await app.handle(
      new Request('http://localhost/api/admin/webhooks', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(listed.status).toBe(200)
    expect(await listed.text()).not.toContain(secret)

    await createPage(app, token, 'docs/webhook', 'hello webhook')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://hooks.example.com/wiki')
    const payload = JSON.parse(calls[0]!.body) as {
      schemaVersion: number
      type: string
      actor: { id: string | null }
      data: { page: { path: string } }
    }
    expect(payload.schemaVersion).toBe(1)
    expect(payload.type).toBe('page.created')
    expect(payload.actor.id).toBeTruthy()
    expect(payload.data.page.path).toBe('docs/webhook')

    const timestamp = calls[0]!.headers.get('x-ts-wiki-timestamp')!
    const expectedSignature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${calls[0]!.body}`).digest('hex')}`
    expect(calls[0]!.headers.get('x-ts-wiki-signature')).toBe(expectedSignature)

    const deliveries = await app.handle(
      new Request('http://localhost/api/admin/webhooks/deliveries', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(deliveries.status).toBe(200)
    expect(await deliveries.json()).toMatchObject({
      deliveries: [expect.objectContaining({ eventType: 'page.created', status: 'succeeded', attempts: 1 })],
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('failed webhook deliveries are visible and retryable', async () => {
    let shouldSucceed = false
    const fetcher: WebhookFetcher = async () =>
      shouldSucceed
        ? new Response('', { status: 204 })
        : new Response('nope', { status: 500, statusText: 'nope' })
    const { app } = createFixture(undefined, { webhookFetcher: fetcher })
    const { token } = await register(app, 'admin@example.com')

    const webhook = await app.handle(
      jsonRequest(
        '/api/admin/webhooks',
        {
          targetUrl: 'https://hooks.example.com/failing',
          secret: 'retry-secret',
          eventTypes: ['page.created'],
        },
        token,
      ),
    )
    expect(webhook.status).toBe(200)
    await createPage(app, token, 'docs/retry', 'retry me')

    const failed = await app.handle(
      new Request('http://localhost/api/admin/webhooks/deliveries?status=failed', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(failed.status).toBe(200)
    const failedBody = await failed.json() as { deliveries: Array<{ id: string; status: string; attempts: number }> }
    expect(failedBody.deliveries).toHaveLength(1)
    expect(failedBody.deliveries[0]).toMatchObject({ status: 'failed', attempts: 1 })

    shouldSucceed = true
    const retry = await app.handle(
      new Request(`http://localhost/api/admin/webhooks/deliveries/${failedBody.deliveries[0]!.id}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({
      delivery: expect.objectContaining({ status: 'succeeded', attempts: 2 }),
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('enabled automation rules can add page metadata on matching updates', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const rule = await app.handle(
      jsonRequest(
        '/api/admin/automation-rules',
        {
          name: 'Verify docs updates',
          type: 'page-updated-metadata',
          enabled: false,
          config: { pathPrefix: 'docs', label: 'triaged', status: 'verified' },
        },
        token,
      ),
    )
    expect(rule.status).toBe(200)
    const ruleBody = await rule.json() as { rule: { id: string } }

    await createPage(app, token, 'docs/auto', 'seed')
    const disabledUpdate = await app.handle(
      new Request('http://localhost/api/page?path=docs/auto', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: 'changed once' }),
      }),
    )
    expect(disabledUpdate.status).toBe(200)
    const afterDisabled = await app.handle(new Request('http://localhost/api/page?path=docs/auto'))
    expect(await afterDisabled.json()).toMatchObject({
      page: expect.objectContaining({ labels: '[]', status: 'draft' }),
    })

    const enabled = await app.handle(
      new Request(`http://localhost/api/admin/automation-rules/${ruleBody.rule.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: true }),
      }),
    )
    expect(enabled.status).toBe(200)

    const enabledUpdate = await app.handle(
      new Request('http://localhost/api/page?path=docs/auto', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: 'changed twice' }),
      }),
    )
    expect(enabledUpdate.status).toBe(200)
    const afterEnabled = await app.handle(new Request('http://localhost/api/page?path=docs/auto'))
    expect(await afterEnabled.json()).toMatchObject({
      page: expect.objectContaining({ labels: '["triaged"]', status: 'verified' }),
    })
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

  test('stays responsive during concurrent saves with SSE churn', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/load', 'seed')

    const streams = await Promise.all(
      Array.from({ length: 8 }, () => app.handle(new Request(`http://localhost/api/events?token=${token}`))),
    )
    for (const response of streams) expect(response.status).toBe(200)

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        app.handle(
          new Request('http://localhost/api/page?path=docs/load', {
            method: 'PUT',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ content: `save ${index}` }),
          }),
        ).then((response) => expect(response.status).toBe(200)),
      ),
    )

    await Promise.all(streams.map((response) => response.body?.cancel().catch(() => undefined)))
    const health = await app.handle(new Request('http://localhost/api/health'))
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true })
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

    const read = await app.handle(new Request('http://localhost/api/page?path=docs/target'))
    expect(read.status).toBe(200)

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

    const comment = await app.handle(
      jsonRequest('/api/page/comments', { path: 'docs/target', body: 'Looks good @ada' }, token),
    )
    expect(comment.status).toBe(200)
    const commentBody = await comment.json()
    expect(commentBody.comment.mentions).toEqual(['ada'])

    const resolved = await app.handle(
      new Request(`http://localhost/api/page/comments/${commentBody.comment.id}/resolve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(resolved.status).toBe(200)

    const analytics = await app.handle(
      new Request('http://localhost/api/admin/analytics', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(analytics.status).toBe(200)
    expect((await analytics.json()).topPages).toContainEqual(
      expect.objectContaining({ path: 'docs/target', views: 1 }),
    )
  }, HTTP_TEST_TIMEOUT_MS)

  test('moving a page leaves redirects from previous paths', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/old', 'old content')

    const firstMove = await app.handle(
      jsonRequest('/api/page/move', { oldPath: 'docs/old', newPath: 'docs/middle' }, token),
    )
    expect(firstMove.status).toBe(200)
    const secondMove = await app.handle(
      jsonRequest('/api/page/move', { oldPath: 'docs/middle', newPath: 'docs/new' }, token),
    )
    expect(secondMove.status).toBe(200)

    const old = await app.handle(new Request('http://localhost/api/page?path=docs/old'))
    expect(old.status).toBe(200)
    expect(await old.json()).toMatchObject({
      page: expect.objectContaining({ path: 'docs/new' }),
      redirectedFrom: ['docs/old'],
    })

    const middle = await app.handle(new Request('http://localhost/api/page?path=docs/middle'))
    expect(middle.status).toBe(200)
    expect(await middle.json()).toMatchObject({
      page: expect.objectContaining({ path: 'docs/new' }),
      redirectedFrom: ['docs/middle'],
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('moves pages to trash, restores, archives, and purges through HTTP routes', async () => {
    const { app, db } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/lifecycle', 'recoverable papaya')
    const comment = await app.handle(
      jsonRequest('/api/page/comments', { path: 'docs/lifecycle', body: 'contains sensitive note' }, token),
    )
    expect(comment.status).toBe(200)
    const viewed = await app.handle(new Request('http://localhost/api/page?path=docs/lifecycle'))
    expect(viewed.status).toBe(200)

    const deleted = await app.handle(
      new Request('http://localhost/api/page?path=docs/lifecycle', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(deleted.status).toBe(200)

    const trash = await app.handle(
      new Request('http://localhost/api/pages/trash', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(trash.status).toBe(200)
    expect((await trash.json()).pages).toContainEqual(
      expect.objectContaining({ path: 'docs/lifecycle', lifecycle: 'deleted' }),
    )

    const restored = await app.handle(
      jsonRequest('/api/page/restore', { path: 'docs/lifecycle' }, token),
    )
    expect(restored.status).toBe(200)

    const archived = await app.handle(
      jsonRequest('/api/page/archive', { path: 'docs/lifecycle' }, token),
    )
    expect(archived.status).toBe(200)

    const purged = await app.handle(
      new Request('http://localhost/api/page/purge?path=docs/lifecycle', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(purged.status).toBe(200)
    expect(tableCount(db, 'page_revisions')).toBe(0)
    expect(tableCount(db, 'page_comments')).toBe(0)
    expect(tableCount(db, 'page_analytics')).toBe(0)
  }, HTTP_TEST_TIMEOUT_MS)

  test('exports pages/site data and imports markdown frontmatter', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/export', '# Export\n\nbody')

    const markdown = await app.handle(new Request('http://localhost/api/export/page?path=docs/export'))
    expect(markdown.status).toBe(200)
    expect(markdown.headers.get('content-type')).toContain('text/markdown')
    expect(await markdown.text()).toContain('title: docs/export')

    const site = await app.handle(
      new Request('http://localhost/api/export/site', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(site.status).toBe(200)
    expect((await site.json()).pages).toContainEqual(expect.objectContaining({ path: 'docs/export' }))

    const imported = await app.handle(
      jsonRequest(
        '/api/import/markdown',
        {
          path: 'docs/imported',
          content: '---\ntitle: Imported\ndescription: From file\n---\n\nHello import',
          labels: ['imported'],
          status: 'verified',
        },
        token,
      ),
    )
    expect(imported.status).toBe(200)
    expect((await imported.json()).page).toMatchObject({
      path: 'docs/imported',
      title: 'Imported',
      labels: '["imported"]',
      status: 'verified',
    })
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app webhooks and automation', () => {
  test('delivers signed webhooks and applies a page-updated metadata rule', async () => {
    const deliveries: Array<{ url: string; headers: Headers; body: WebhookPayload }> = []
    const webhookFetcher: WebhookFetcher = async (url, init) => {
      deliveries.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)) as WebhookPayload,
      })
      return new Response('ok', { status: 200 })
    }
    const { app } = createFixture(undefined, { webhookFetcher })
    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/hook', 'before')

    const subscription = await app.handle(
      jsonRequest('/api/admin/webhooks', {
        name: 'Receiver',
        targetUrl: 'https://hooks.example.com/wiki',
        secret: 'signing-secret',
        eventTypes: ['page.updated'],
      }, token),
    )
    expect(subscription.status).toBe(200)
    expect((await subscription.json()).webhook).not.toHaveProperty('secret')

    const rule = await app.handle(
      jsonRequest('/api/admin/automation-rules', {
        name: 'Verify docs',
        type: 'page-updated-metadata',
        enabled: true,
        config: { pathPrefix: 'docs', label: 'reviewed', status: 'verified' },
      }, token),
    )
    expect(rule.status).toBe(200)

    const updated = await app.handle(
      new Request('http://localhost/api/page?path=docs%2Fhook', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: 'after' }),
      }),
    )
    expect(updated.status).toBe(200)

    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]!.url).toBe('https://hooks.example.com/wiki')
    expect(deliveries[0]!.headers.get('x-ts-wiki-signature')).toMatch(/^sha256=/)
    expect(deliveries[0]!.body).toMatchObject({
      schemaVersion: 1,
      type: 'page.updated',
      data: { page: { path: 'docs/hook', status: 'verified', labels: ['reviewed'] } },
    })

    const page = await app.handle(new Request('http://localhost/api/page?path=docs%2Fhook'))
    expect(page.status).toBe(200)
    expect((await page.json()).page).toMatchObject({ status: 'verified', labels: '["reviewed"]' })

    const history = await app.handle(
      new Request('http://localhost/api/admin/webhooks/deliveries', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(history.status).toBe(200)
    expect((await history.json()).deliveries[0]).toMatchObject({
      eventType: 'page.updated',
      status: 'succeeded',
      attempts: 1,
    })
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

    const assets = await app.handle(
      new Request('http://localhost/api/assets', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(assets.status).toBe(200)
    const listed = (await assets.json()) as { assets: Array<{ id: string; filename: string; url: string }> }
    expect(listed.assets).toContainEqual(expect.objectContaining({ filename: 'avatar.png', url: body.url }))

    const renamed = await app.handle(
      new Request(`http://localhost/api/assets/${listed.assets[0]!.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ filename: 'renamed.png' }),
      }),
    )
    expect(renamed.status).toBe(200)
    expect((await renamed.json()).asset).toMatchObject({ filename: 'renamed.png', url: body.url })

    const removed = await app.handle(
      new Request(`http://localhost/api/assets/${listed.assets[0]!.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(removed.status).toBe(200)
    expect(existsSync(join(dataDir, body.url))).toBe(false)
  }, HTTP_TEST_TIMEOUT_MS)

  test('uses injected R2-style asset storage keys and public URLs', async () => {
    const stored = new Map<string, { bytes: Uint8Array; contentType: string }>()
    const uploads: Array<{ storageName: string; bytes: Uint8Array; contentType: string }> = []
    const deletes: string[] = []
    const publicBaseUrl = 'https://cdn.example.com/media'
    const encodeStorageName = (storageName: string): string =>
      storageName.split('/').map(encodeURIComponent).join('/')
    const assetStorage: AssetStorage = {
      type: 'r2',
      storageNameForUpload: (id, file) => `assets/${id}/${safeAssetFilename(file)}`,
      url: (storageName) => `${publicBaseUrl}/${encodeStorageName(storageName)}`,
      async put({ storageName, file }) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const contentType = file.type
        uploads.push({ storageName, bytes, contentType })
        stored.set(storageName, { bytes, contentType })
      },
      async get(storageName) {
        const asset = stored.get(storageName)
        if (!asset) return null
        const body = new ArrayBuffer(asset.bytes.byteLength)
        new Uint8Array(body).set(asset.bytes)
        return {
          body: new Blob([body], { type: asset.contentType }),
          headers: new Headers({ 'content-type': asset.contentType }),
        }
      },
      async delete(storageName) {
        deletes.push(storageName)
        stored.delete(storageName)
      },
    }
    const { app } = createFixture(undefined, { assetStorage })
    const { token } = await register(app, 'admin@example.com')
    const form = new FormData()
    form.set('file', new File([png1x1], 'avatar.png', { type: 'image/png' }))

    const upload = await app.handle(
      new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
    )

    expect(upload.status).toBe(200)
    const body = (await upload.json()) as { id: string; filename: string; url: string }
    expect(body.filename).toBe('avatar.png')
    expect(body.url).toMatch(/^https:\/\/cdn\.example\.com\/media\/assets\/[^/]+\/avatar\.png$/)
    expect(body.url).not.toContain('secret')
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.storageName).toBe(`assets/${body.id}/avatar.png`)
    expect(uploads[0]!.bytes.byteLength).toBe(png1x1.byteLength)

    const proxied = await app.handle(new Request(`http://localhost/assets/${uploads[0]!.storageName}`))
    expect(proxied.status).toBe(200)
    expect(proxied.headers.get('content-type')).toBe('image/png')
    expect(proxied.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await proxied.arrayBuffer()).byteLength).toBe(png1x1.byteLength)

    const listed = await app.handle(
      new Request('http://localhost/api/assets', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(listed.status).toBe(200)
    const listBody = (await listed.json()) as { assets: Array<{ id: string; url: string; storageName: string }> }
    expect(listBody.assets[0]).toMatchObject({
      id: body.id,
      url: body.url,
      storageName: uploads[0]!.storageName,
    })

    const removed = await app.handle(
      new Request(`http://localhost/api/assets/${body.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(removed.status).toBe(200)
    expect(deletes).toEqual([uploads[0]!.storageName])
    expect(stored.has(uploads[0]!.storageName)).toBe(false)
  }, HTTP_TEST_TIMEOUT_MS)

  test('encoded traversal asset paths return 404', async () => {
    const { app } = createFixture()

    const response = await app.handle(new Request('http://localhost/assets/..%2Fts-wiki.sqlite'))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
  })

  test('accepts non-image document attachments', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    const form = new FormData()
    form.set('file', new File(['%PDF-1.7\n'], 'runbook.pdf', { type: 'application/pdf' }))

    const upload = await app.handle(
      new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
    )

    expect(upload.status).toBe(200)
    const body = await upload.json()
    expect(body).toMatchObject({
      filename: 'runbook.pdf',
    })
    const served = await app.handle(new Request(`http://localhost${body.url}`))
    expect(served.status).toBe(200)
    expect(served.headers.get('content-disposition')).toBe('attachment')
  }, HTTP_TEST_TIMEOUT_MS)

  test('honors the configured upload byte limit', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, assetUpload: { maxBytes: 4 } }),
    })
    const { token } = await register(app, 'admin@example.com')
    const form = new FormData()
    form.set('file', new File(['12345'], 'tiny.png', { type: 'image/png' }))

    const upload = await app.handle(
      new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
    )

    expect(upload.status).toBe(422)
    expect(await upload.json()).toMatchObject({ error: { message: 'Asset must be 4B or smaller' } })
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
