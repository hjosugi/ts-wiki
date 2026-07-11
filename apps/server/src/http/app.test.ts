import { afterEach, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Env } from '../env.ts'
import { createDb, type DB } from '../db/client.ts'
import { sampleGuidePages } from '../sample-content.ts'
import { ASSET_MAX_BYTES, safeAssetFilename } from '../services/assets.ts'
import { totpCode } from '../services/auth.ts'
import type { MailMessage, MailSender } from '../services/mail.ts'
import type { WebhookFetcher, WebhookHostnameResolver, WebhookPayload } from '../services/webhooks.ts'
import type { AssetStorage } from '../storage/assets.ts'
import type { LogEvent, StructuredLogger } from '../observability/logging.ts'
import { createApp, type App } from './app.ts'
import { passkeys } from '../db/schema.ts'
import { APP_VERSION } from '../version.ts'

const fixtures: Array<{ db: DB; dataDir: string; app: App }> = []
const HTTP_TEST_TIMEOUT_MS = 15_000

const png1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
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
    requireEmailVerification: false,
    requireTwoFactor: false,
    oidcProviders: [],
  },
  search: {
    ftsTokenizer: 'unicode61',
  },
  assetUpload: {
    maxBytes: ASSET_MAX_BYTES,
  },
  webhooks: {
    allowPrivateTargets: false,
    maxAttempts: 3,
    backoffMs: [60_000, 120_000, 240_000, 480_000, 900_000],
    maxResponseBytes: 2000,
    maxErrorBytes: 1000,
  },
  audit: {
    persist: true,
    retentionDays: 90,
    maxRows: 10_000,
  },
  mail: {
    smtpUrl: null,
    from: 'ts-wiki <no-reply@localhost>',
    timeoutMs: 10_000,
  },
  branding: {
    siteTitle: null,
    accentColor: null,
    theme: null,
    allowHeadInjection: false,
  },
  localization: {
    defaultLocale: null,
    timezone: null,
    dateFormat: null,
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

const publicWebhookResolver: WebhookHostnameResolver = async () => ['93.184.216.34']

const createFixture = (
  cors?: Env['cors'],
  options: {
    webDist?: boolean
    logger?: StructuredLogger
    assetStorage?: AssetStorage
    mailSender?: MailSender
    webhookFetcher?: WebhookFetcher
    webhookResolver?: WebhookHostnameResolver
    env?: (env: Env) => Env
  } = {},
): { app: App; db: DB; dataDir: string } => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ts-wiki-test-'))
  mkdirSync(join(dataDir, 'assets'), { recursive: true })
  if (options.webDist) {
    mkdirSync(join(dataDir, 'web-dist', 'assets'), { recursive: true })
    writeFileSync(
      join(dataDir, 'web-dist', 'index.html'),
      '<!doctype html><html><head><title>ts-wiki</title></head><body><div id="app"></div></body></html>',
    )
    writeFileSync(join(dataDir, 'web-dist', 'assets', 'app.js'), 'console.log("ts-wiki")')
  }
  const env = options.env?.(testEnv(dataDir, cors)) ?? testEnv(dataDir, cors)
  const db = createDb(':memory:', { ftsTokenizer: env.search.ftsTokenizer })
  const app = createApp({
    db,
    env,
    logger: options.logger ?? noopLogger,
    assetStorage: options.assetStorage,
    mailSender: options.mailSender,
    webhookFetcher: options.webhookFetcher,
    webhookResolver: options.webhookResolver ?? (options.webhookFetcher ? publicWebhookResolver : undefined),
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

const base64UrlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

const base64UrlBytes = (value: string): string =>
  Buffer.from(value).toString('base64url')

const oidcDiscoveryResponse = () =>
  new Response(JSON.stringify({
    authorization_endpoint: 'https://idp.example.com/auth',
    token_endpoint: 'https://idp.example.com/token',
    jwks_uri: 'https://idp.example.com/jwks',
  }), {
    headers: { 'content-type': 'application/json' },
  })

const passkeyAuthenticationVerifyBody = (challenge = 'missing') => ({
  response: {
    id: 'missing',
    rawId: 'missing',
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64UrlJson({ challenge }),
      authenticatorData: base64UrlBytes('authenticator-data'),
      signature: base64UrlBytes('signature'),
    },
  },
})

const passkeyRegistrationVerifyBody = (challenge = 'missing') => ({
  response: {
    id: 'missing',
    rawId: 'missing',
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64UrlJson({ challenge }),
      attestationObject: base64UrlBytes('attestation-object'),
    },
  },
})

const captureMail = (): { messages: MailMessage[]; sender: MailSender } => {
  const messages: MailMessage[] = []
  return {
    messages,
    sender: async (message) => {
      messages.push(message)
    },
  }
}

const tokenFromMail = (message: MailMessage, path: string): string => {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = message.text.match(new RegExp(`${escaped}\\?token=([^\\s]+)`))
  expect(typeof match?.[1]).toBe('string')
  return decodeURIComponent(match![1]!)
}

const register = async (app: App, email: string): Promise<{ token: string; user: { id: string; role: string } }> => {
  const response = await app.handle(
    jsonRequest('/api/auth/register', { email, name: email.split('@')[0], password: 'password' }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

const createPage = async (app: App, token: string, path: string, content = 'hello'): Promise<void> => {
  const response = await app.handle(
    jsonRequest('/api/pages', { path, title: path, content, status: 'verified' }, token),
  )
  expect(response.status).toBe(200)
}

const uploadPngAsset = async (
  app: App,
  token: string,
  filename: string,
  folder?: string,
): Promise<{ id: string; filename: string; folder: string; url: string }> => {
  const form = new FormData()
  form.set('file', new File([png1x1], filename, { type: 'image/png' }))
  if (folder !== undefined) form.set('folder', folder)
  const response = await app.handle(
    new Request('http://localhost/api/assets', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

const realtimeTicket = async (app: App, token: string): Promise<string> => {
  const response = await app.handle(
    new Request('http://localhost/api/realtime/ticket', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }),
  )
  expect(response.status).toBe(200)
  const body = await response.json() as { ticket?: unknown }
  expect(typeof body.ticket).toBe('string')
  return body.ticket as string
}

const tableCount = (db: DB, table: string): number =>
  (db.$client.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count

const pageRows = (db: DB): Array<{
  path: string
  title: string
  locale: string
  labels: string
  content: string
}> =>
  db.$client
    .prepare('SELECT path, title, locale, labels, content FROM pages ORDER BY path')
    .all() as Array<{ path: string; title: string; locale: string; labels: string; content: string }>

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.app.server?.stop(true)
    fixture.db.$client.close()
    rmSync(fixture.dataDir, { recursive: true, force: true })
  }
})

describe('http app setup', () => {
  const setupBody = {
    email: 'owner@example.com',
    name: 'Owner',
    password: 'password',
    siteTitle: 'Knowledge Base',
    theme: 'dark',
    tokenizer: 'trigram',
    sampleContent: true,
  } as const

  test('reports setup status and completes the first-run wizard', async () => {
    const { app, db } = createFixture()

    const before = await app.handle(new Request('http://localhost/api/setup/status'))
    expect(before.status).toBe(200)
    expect(await before.json()).toEqual({ needsSetup: true })

    const complete = await app.handle(jsonRequest('/api/setup/complete', setupBody))
    expect(complete.status).toBe(201)
    const body = await complete.json() as {
      token: string
      user: { email: string; role: string; totpEnabled: boolean }
      settings: { siteTitle: string; theme: string; homePath: string }
      home: { path: string; title: string; pinned: boolean }
      searchIndex: { tokenizer: string }
    }
    expect(body.token.length).toBeGreaterThan(20)
    expect(body.user).toMatchObject({ email: 'owner@example.com', role: 'admin', totpEnabled: false })
    expect(body.settings).toMatchObject({ siteTitle: 'Knowledge Base', theme: 'dark', homePath: 'home' })
    expect(body.home).toMatchObject({ path: 'home', title: 'Knowledge Base', pinned: true })
    expect(body.searchIndex.tokenizer).toBe('trigram')
    expect(tableCount(db, 'users')).toBe(1)
    expect(tableCount(db, 'pages')).toBe(1 + sampleGuidePages.length)

    const seededPages = new Map(pageRows(db).map((page) => [page.path, page]))
    for (const page of sampleGuidePages) {
      const seeded = seededPages.get(page.path)
      expect(seeded).toBeDefined()
      expect(seeded?.title).toBe(page.title)
      expect(seeded?.locale).toBe(page.locale)
      expect(JSON.parse(seeded?.labels ?? '[]')).toEqual([...page.labels])
    }
    expect(seededPages.get('home')?.content).toContain('/help/en/basic-editing')
    expect(seededPages.get('home')?.content).toContain('/help/ja/basic-editing')
    expect(seededPages.get('help/en/basic-editing')?.content).toContain('[[home]]')
    expect(seededPages.get('help/ja/basic-editing')?.content).toContain('テンプレート')

    const after = await app.handle(new Request('http://localhost/api/setup/status'))
    expect(after.status).toBe(200)
    expect(await after.json()).toEqual({ needsSetup: false })

    const me = await app.handle(new Request('http://localhost/api/auth/me', {
      headers: { authorization: `Bearer ${body.token}` },
    }))
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ user: { email: 'owner@example.com', role: 'admin' } })
  }, HTTP_TEST_TIMEOUT_MS)

  test('is disabled after an admin exists', async () => {
    const { app } = createFixture()

    await register(app, 'admin@example.com')

    const status = await app.handle(new Request('http://localhost/api/setup/status'))
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ needsSetup: false })

    const complete = await app.handle(jsonRequest('/api/setup/complete', setupBody))
    expect(complete.status).toBe(403)
  }, HTTP_TEST_TIMEOUT_MS)

  test('rejects invalid setup input before creating the owner account', async () => {
    const { app, db } = createFixture()

    const response = await app.handle(jsonRequest('/api/setup/complete', {
      ...setupBody,
      siteTitle: '   ',
    }))

    expect(response.status).toBe(422)
    expect(tableCount(db, 'users')).toBe(0)
  }, HTTP_TEST_TIMEOUT_MS)
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

  test('rate limits credential-adjacent auth routes by surface', async () => {
    const { app } = createFixture()

    const passkeyVerifyBody = passkeyAuthenticationVerifyBody()
    for (let i = 0; i < 10; i += 1) {
      const response = await app.handle(jsonRequest('/api/auth/passkeys/login/verify', passkeyVerifyBody))
      expect(response.status).toBe(401)
    }
    expect((await app.handle(jsonRequest('/api/auth/passkeys/login/verify', passkeyVerifyBody))).status).toBe(429)

    const passwordChangeRequest = () =>
      new Request('http://localhost/api/auth/password', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'password', newPassword: 'new-password' }),
      })
    for (let i = 0; i < 10; i += 1) {
      const response = await app.handle(passwordChangeRequest())
      expect(response.status).toBe(401)
    }
    expect((await app.handle(passwordChangeRequest())).status).toBe(429)

    for (let i = 0; i < 10; i += 1) {
      const response = await app.handle(
        new Request('http://localhost/api/auth/oidc/unknown/callback?code=x&state=y'),
      )
      expect(response.status).toBe(422)
    }
    expect((await app.handle(
      new Request('http://localhost/api/auth/oidc/unknown/callback?code=x&state=y'),
    )).status).toBe(429)
  }, HTTP_TEST_TIMEOUT_MS)

  test('routes configured OIDC providers through the generic auth provider seam', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => oidcDiscoveryResponse()) as unknown as typeof fetch
    try {
      const { app } = createFixture(undefined, {
        env: (env) => ({
          ...env,
          auth: {
            ...env.auth,
            oidcProviders: [{
              id: 'acme',
              label: 'Acme ID',
              issuer: 'https://idp.example.com',
              clientId: 'client-id',
              clientSecret: 'client-secret',
              redirectUri: 'http://localhost/api/auth/acme/callback',
              scopes: ['openid', 'email', 'profile'],
              allowRegistration: true,
              allowedEmailDomains: [],
              defaultRole: 'viewer',
            }],
          },
        }),
      })

      const providers = await app.handle(new Request('http://localhost/api/auth/providers'))
      expect(providers.status).toBe(200)
      expect(await providers.json()).toEqual({
        providers: [{
          id: 'acme',
          label: 'Acme ID',
          kind: 'oidc',
          type: 'oidc',
          loginUrl: '/api/auth/acme/start',
        }],
      })

      const genericStart = await app.handle(new Request('http://localhost/api/auth/acme/start?redirect=/docs'))
      expect(genericStart.status).toBe(302)
      const location = new URL(genericStart.headers.get('location') ?? '')
      expect(location.origin).toBe('https://idp.example.com')
      expect(location.searchParams.get('client_id')).toBe('client-id')
      expect(location.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/acme/callback')
      expect(location.searchParams.get('state')).toBeTruthy()

      const missingCallbackParams = await app.handle(new Request('http://localhost/api/auth/acme/callback'))
      expect(missingCallbackParams.status).toBe(422)

      const legacyStart = await app.handle(new Request('http://localhost/api/auth/oidc/acme/start'))
      expect(legacyStart.status).toBe(302)
    } finally {
      globalThis.fetch = originalFetch
    }
  }, HTTP_TEST_TIMEOUT_MS)

  test('rate limits TOTP enable and disable attempts', async () => {
    const enableFixture = createFixture()
    const { token } = await register(enableFixture.app, 'admin@example.com')

    const setup = await enableFixture.app.handle(
      new Request('http://localhost/api/auth/totp/setup', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(setup.status).toBe(200)
    const secret = ((await setup.json()) as { secret: string }).secret
    const code = totpCode(secret)
    const invalidCode = code === '000000' ? '000001' : '000000'

    for (let i = 0; i < 10; i += 1) {
      const response = await enableFixture.app.handle(jsonRequest('/api/auth/totp/enable', { code: invalidCode }, token))
      expect(response.status).toBe(401)
    }
    expect((await enableFixture.app.handle(jsonRequest('/api/auth/totp/enable', { code: invalidCode }, token))).status).toBe(429)

    const disableFixture = createFixture()
    const disableAdmin = await register(disableFixture.app, 'admin@example.com')
    const disableSetup = await disableFixture.app.handle(
      new Request('http://localhost/api/auth/totp/setup', {
        method: 'POST',
        headers: { authorization: `Bearer ${disableAdmin.token}` },
      }),
    )
    expect(disableSetup.status).toBe(200)
    const disableSecret = ((await disableSetup.json()) as { secret: string }).secret
    const disableCode = totpCode(disableSecret)
    const invalidDisableCode = disableCode === '000000' ? '000001' : '000000'

    const enabled = await disableFixture.app.handle(jsonRequest('/api/auth/totp/enable', { code: disableCode }, disableAdmin.token))
    expect(enabled.status).toBe(200)

    for (let i = 0; i < 10; i += 1) {
      const response = await disableFixture.app.handle(
        jsonRequest('/api/auth/totp/disable', { code: invalidDisableCode }, disableAdmin.token),
      )
      expect(response.status).toBe(401)
    }
    expect((await disableFixture.app.handle(
      jsonRequest('/api/auth/totp/disable', { code: invalidDisableCode }, disableAdmin.token),
    )).status).toBe(429)
  }, HTTP_TEST_TIMEOUT_MS)

  test('rate limits anonymous private-mode read attempts', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, auth: { ...env.auth, privateWiki: true } }),
    })

    for (let i = 0; i < 120; i += 1) {
      const response = await app.handle(new Request('http://localhost/api/search?q=docs'))
      expect(response.status).toBe(401)
    }

    const limited = await app.handle(new Request('http://localhost/api/search?q=docs'))
    expect(limited.status).toBe(429)
  }, HTTP_TEST_TIMEOUT_MS)

  test('TOTP can be enabled and is then required at login', async () => {
    const { logger, events } = captureLogger()
    const { app } = createFixture(undefined, { logger })
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
    const enabledBody = await enabled.json() as { user: { totpEnabled: boolean }; recoveryCodes: string[] }
    expect(enabledBody.user.totpEnabled).toBe(true)
    expect(enabledBody.recoveryCodes).toHaveLength(8)
    expect(enabledBody.recoveryCodes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    const missingCode = await app.handle(
      jsonRequest('/api/auth/login', { email: 'admin@example.com', password: 'password' }),
    )
    expect(missingCode.status).toBe(401)

    const loggedIn = await app.handle(
      jsonRequest('/api/auth/login', { email: 'admin@example.com', password: 'password', totpCode: code }),
    )
    expect(loggedIn.status).toBe(200)
    expect((await loggedIn.json()).user.totpEnabled).toBe(true)

    const recoveryLogin = await app.handle(
      jsonRequest('/api/auth/login', {
        email: 'admin@example.com',
        password: 'password',
        totpCode: enabledBody.recoveryCodes[0],
      }),
    )
    expect(recoveryLogin.status).toBe(200)
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'auth.totp.recovery_code.use' }))
    const reusedRecoveryCode = await app.handle(
      jsonRequest('/api/auth/login', {
        email: 'admin@example.com',
        password: 'password',
        totpCode: enabledBody.recoveryCodes[0],
      }),
    )
    expect(reusedRecoveryCode.status).toBe(401)

    const regenerated = await app.handle(jsonRequest('/api/auth/totp/recovery-codes', { code }, token))
    expect(regenerated.status).toBe(200)
    const regeneratedBody = await regenerated.json() as { recoveryCodes: string[] }
    expect(regeneratedBody.recoveryCodes).toHaveLength(8)
    expect(regeneratedBody.recoveryCodes).not.toContain(enabledBody.recoveryCodes[1])
  }, HTTP_TEST_TIMEOUT_MS)

  test('required 2FA returns a setup-only token for accounts without a factor', async () => {
    const { logger, events } = captureLogger()
    const { app } = createFixture(undefined, {
      logger,
      env: (env) => ({ ...env, auth: { ...env.auth, requireTwoFactor: true } }),
    })
    await register(app, 'admin@example.com')

    const setupRequired = await app.handle(
      jsonRequest('/api/auth/login', { email: 'admin@example.com', password: 'password' }),
    )
    expect(setupRequired.status).toBe(202)
    const setupBody = await setupRequired.json() as { setupToken: string; twoFactorSetupRequired: true }
    expect(setupBody.twoFactorSetupRequired).toBe(true)
    expect(typeof setupBody.setupToken).toBe('string')
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'auth.2fa.enforce' }))

    const generalAuth = await app.handle(new Request('http://localhost/api/auth/me', {
      headers: { authorization: `Bearer ${setupBody.setupToken}` },
    }))
    expect(generalAuth.status).toBe(401)

    const setup = await app.handle(jsonRequest('/api/auth/totp/setup', { setupToken: setupBody.setupToken }))
    expect(setup.status).toBe(200)
    const secret = ((await setup.json()) as { secret: string }).secret
    const code = totpCode(secret)

    const enabled = await app.handle(jsonRequest('/api/auth/totp/enable', {
      setupToken: setupBody.setupToken,
      code,
    }))
    expect(enabled.status).toBe(200)
    const enabledBody = await enabled.json() as { token: string; user: { totpEnabled: boolean } }
    expect(enabledBody.user.totpEnabled).toBe(true)

    expect((await app.handle(jsonRequest('/api/auth/login', { email: 'admin@example.com', password: 'password' }))).status).toBe(401)
    expect((await app.handle(jsonRequest('/api/auth/login', {
      email: 'admin@example.com',
      password: 'password',
      totpCode: code,
    }))).status).toBe(200)
  }, HTTP_TEST_TIMEOUT_MS)

  test('required 2FA does not allow password-only login for passkey users', async () => {
    const { app, db } = createFixture(undefined, {
      env: (env) => ({ ...env, auth: { ...env.auth, requireTwoFactor: true } }),
    })
    const registered = await register(app, 'admin@example.com')
    db.insert(passkeys).values({
      id: 'test-passkey',
      userId: registered.user.id,
      name: 'Test device',
      publicKey: Buffer.from('test-public-key').toString('base64url'),
      counter: 0,
      transports: '[]',
      deviceType: 'singleDevice',
      backedUp: false,
      createdAt: Date.now(),
      lastUsedAt: null,
    }).run()

    const login = await app.handle(jsonRequest('/api/auth/login', {
      email: 'admin@example.com',
      password: 'password',
    }))
    expect(login.status).toBe(401)
    expect(await login.json()).toMatchObject({
      error: { message: 'Passkey authentication is required for this account' },
    })
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
      jsonRequest('/api/auth/passkeys/login/verify', passkeyAuthenticationVerifyBody(loginBody.options.challenge)),
    )
    expect(invalidVerify.status).toBe(401)
  }, HTTP_TEST_TIMEOUT_MS)

  test('passkey verify routes reject malformed WebAuthn payloads at the boundary', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const malformedRegistration = await app.handle(
      jsonRequest('/api/auth/passkeys/register/verify', { response: { id: 'missing' } }, token),
    )
    expect(malformedRegistration.status).toBe(422)

    const malformedAuthentication = await app.handle(
      jsonRequest('/api/auth/passkeys/login/verify', { response: { id: 'missing' } }),
    )
    expect(malformedAuthentication.status).toBe(422)

    const semanticallyInvalidRegistration = await app.handle(
      jsonRequest('/api/auth/passkeys/register/verify', passkeyRegistrationVerifyBody(), token),
    )
    expect(semanticallyInvalidRegistration.status).toBe(401)
  }, HTTP_TEST_TIMEOUT_MS)

  test('self-service password reset sends a non-enumerating email flow', async () => {
    const mail = captureMail()
    const { app } = createFixture(undefined, {
      mailSender: mail.sender,
      env: (env) => ({ ...env, mail: { ...env.mail, smtpUrl: 'smtp://mail.test' } }),
    })
    await register(app, 'user@example.com')

    const unknown = await app.handle(jsonRequest('/api/auth/forgot', { email: 'missing@example.com' }))
    expect(unknown.status).toBe(200)
    expect(mail.messages).toHaveLength(0)

    const forgot = await app.handle(jsonRequest('/api/auth/forgot', { email: 'user@example.com' }))
    expect(forgot.status).toBe(200)
    expect(mail.messages).toHaveLength(1)
    expect(mail.messages[0]!.subject).toContain('password reset')
    const resetToken = tokenFromMail(mail.messages[0]!, '/_reset')

    const reset = await app.handle(jsonRequest('/api/auth/reset', {
      token: resetToken,
      password: 'new-password',
    }))
    expect(reset.status).toBe(200)

    expect((await app.handle(jsonRequest('/api/auth/login', { email: 'user@example.com', password: 'password' }))).status).toBe(401)
    expect((await app.handle(jsonRequest('/api/auth/login', { email: 'user@example.com', password: 'new-password' }))).status).toBe(200)
    expect((await app.handle(jsonRequest('/api/auth/reset', { token: resetToken, password: 'another-password' }))).status).toBe(401)
  }, HTTP_TEST_TIMEOUT_MS)

  test('rate limits forgot and reset password endpoints', async () => {
    const { app } = createFixture()

    for (let i = 0; i < 10; i += 1) {
      expect((await app.handle(jsonRequest('/api/auth/forgot', { email: `missing-${i}@example.com` }))).status).toBe(200)
    }
    expect((await app.handle(jsonRequest('/api/auth/forgot', { email: 'limited@example.com' }))).status).toBe(429)

    for (let i = 0; i < 10; i += 1) {
      expect((await app.handle(jsonRequest('/api/auth/reset', {
        token: 'x'.repeat(24),
        password: 'new-password',
      }))).status).toBe(401)
    }
    expect((await app.handle(jsonRequest('/api/auth/reset', {
      token: 'x'.repeat(24),
      password: 'new-password',
    }))).status).toBe(429)
  }, HTTP_TEST_TIMEOUT_MS)

  test('email verification gate blocks local login until the emailed token is confirmed', async () => {
    const mail = captureMail()
    const { app } = createFixture(undefined, {
      mailSender: mail.sender,
      env: (env) => ({
        ...env,
        auth: { ...env.auth, requireEmailVerification: true },
        mail: { ...env.mail, smtpUrl: 'smtp://mail.test' },
      }),
    })

    const settings = await app.handle(new Request('http://localhost/api/settings/public'))
    expect(settings.status).toBe(200)
    expect(await settings.json()).toMatchObject({ mailConfigured: true, requireEmailVerification: true })

    const registered = await app.handle(
      jsonRequest('/api/auth/register', { email: 'verify@example.com', name: 'Verify', password: 'password' }),
    )
    expect(registered.status).toBe(202)
    expect(await registered.json()).toEqual({ verificationRequired: true })
    expect(mail.messages).toHaveLength(1)

    const blockedLogin = await app.handle(jsonRequest('/api/auth/login', {
      email: 'verify@example.com',
      password: 'password',
    }))
    expect(blockedLogin.status).toBe(401)

    const verifyToken = tokenFromMail(mail.messages[0]!, '/_verify-email')
    const verified = await app.handle(jsonRequest('/api/auth/email/verify', { token: verifyToken }))
    expect(verified.status).toBe(200)

    const login = await app.handle(jsonRequest('/api/auth/login', {
      email: 'verify@example.com',
      password: 'password',
    }))
    expect(login.status).toBe(200)
  }, HTTP_TEST_TIMEOUT_MS)

  test('users can update profile and rotate their own password with audit logs', async () => {
    const { logger, events } = captureLogger()
    const { app } = createFixture(undefined, { logger })
    const admin = await register(app, 'admin@example.com')

    const profile = await app.handle(
      new Request('http://localhost/api/auth/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          name: 'Ada Admin',
          bio: 'Hello **fans**',
          coverUrl: 'https://example.com/cover.jpg',
          links: [{ label: 'YouTube', url: 'https://youtube.com/@ada' }],
          favoritePages: ['docs/favorite'],
        }),
      }),
    )
    expect(profile.status).toBe(200)
    expect(await profile.json()).toMatchObject({
      user: {
        name: 'Ada Admin',
        profileBio: 'Hello **fans**',
        profileCoverUrl: 'https://example.com/cover.jpg',
        profileLinks: [{ label: 'YouTube', url: 'https://youtube.com/@ada' }],
        profileFavoritePages: ['docs/favorite'],
      },
    })

    await createPage(app, admin.token, 'docs/favorite', 'favorite')
    await createPage(app, admin.token, 'docs/authored', 'authored')
    const publicProfile = await app.handle(new Request(`http://localhost/api/users/${admin.user.id}/profile`))
    expect(publicProfile.status).toBe(200)
    expect(await publicProfile.json()).toMatchObject({
      profile: { id: admin.user.id, name: 'Ada Admin', profileBio: 'Hello **fans**' },
      favoritePages: [expect.objectContaining({ path: 'docs/favorite' })],
      authoredPages: expect.arrayContaining([expect.objectContaining({ path: 'docs/authored' })]),
    })

    const password = await app.handle(
      new Request('http://localhost/api/auth/password', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ currentPassword: 'password', newPassword: 'new-password' }),
      }),
    )
    expect(password.status).toBe(200)

    const oldToken = await app.handle(new Request('http://localhost/api/auth/me', {
      headers: { authorization: `Bearer ${admin.token}` },
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

  test('pages expose shared sidebar pinning and manual order metadata', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    const created = await app.handle(
      jsonRequest('/api/pages', {
        path: 'docs/nav',
        title: 'Navigation page',
        content: 'shared nav metadata',
        navOrder: 20.8,
        pinned: true,
      }, token),
    )
    expect(created.status).toBe(200)
    expect((await created.json()).page).toMatchObject({
      path: 'docs/nav',
      navOrder: 20,
      pinned: true,
    })

    const listed = await app.handle(new Request('http://localhost/api/pages', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(listed.status).toBe(200)
    expect((await listed.json()).pages).toContainEqual(expect.objectContaining({
      path: 'docs/nav',
      navOrder: 20,
      pinned: true,
    }))

    const updated = await app.handle(new Request('http://localhost/api/page?path=docs/nav', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ navOrder: null, pinned: false }),
    }))
    expect(updated.status).toBe(200)
    expect((await updated.json()).page).toMatchObject({
      path: 'docs/nav',
      navOrder: null,
      pinned: false,
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('authenticated nav preferences are persisted per user', async () => {
    const { app } = createFixture()
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')

    const anonymous = await app.handle(new Request('http://localhost/api/me/preferences'))
    expect(anonymous.status).toBe(401)

    const saved = await app.handle(new Request('http://localhost/api/me/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({
        preferences: {
          'nav:collapsed': ['docs'],
          'nav:starred': ['docs/alpha'],
          'nav:page-order': { 'docs/alpha': 0, 'docs/beta': 1 },
          'editor:mode': 'visual',
        },
      }),
    }))
    expect(saved.status).toBe(200)
    expect((await saved.json()).preferences).toEqual({
      'nav:collapsed': ['docs'],
      'nav:starred': ['docs/alpha'],
      'nav:page-order': { 'docs/alpha': 0, 'docs/beta': 1 },
      'editor:mode': 'visual',
    })

    const reloaded = await app.handle(new Request('http://localhost/api/me/preferences', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(reloaded.status).toBe(200)
    expect((await reloaded.json()).preferences).toEqual({
      'nav:collapsed': ['docs'],
      'nav:starred': ['docs/alpha'],
      'nav:page-order': { 'docs/alpha': 0, 'docs/beta': 1 },
      'editor:mode': 'visual',
    })

    const isolated = await app.handle(new Request('http://localhost/api/me/preferences', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(isolated.status).toBe(200)
    expect((await isolated.json()).preferences).toEqual({})

    const invalid = await app.handle(new Request('http://localhost/api/me/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ preferences: { 'nav:starred': [42] } }),
    }))
    expect(invalid.status).toBe(422)

    const invalidMode = await app.handle(new Request('http://localhost/api/me/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ preferences: { 'editor:mode': 'wysiwyg' } }),
    }))
    expect(invalidMode.status).toBe(422)
  }, HTTP_TEST_TIMEOUT_MS)

  test('serves an Atom feed of recent page changes', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    const created = await app.handle(
      jsonRequest('/api/pages', { path: 'docs/feed', title: 'Feed & <Title>', content: 'hello' }, token),
    )
    expect(created.status).toBe(200)

    const feed = await app.handle(new Request('http://localhost/feed.xml'))
    expect(feed.status).toBe(200)
    expect(feed.headers.get('content-type')).toContain('application/atom+xml')
    expect(feed.headers.get('cache-control')).toBe('public, max-age=60')
    const xml = await feed.text()
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(xml).toContain('ts-wiki-test recent changes')
    expect(xml).toContain('Feed &amp; &lt;Title&gt; created')
    expect(xml).toContain('http://localhost/docs/feed')
  }, HTTP_TEST_TIMEOUT_MS)

  test('private wiki token-gates the Atom feed', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, auth: { ...env.auth, privateWiki: true } }),
    })
    const anonymous = await app.handle(new Request('http://localhost/feed.xml'))
    expect(anonymous.status).toBe(401)

    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/private-feed', 'secret')
    const authed = await app.handle(new Request('http://localhost/feed.xml', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(authed.status).toBe(200)
    expect(authed.headers.get('cache-control')).toBe('private, max-age=60')
    expect(await authed.text()).toContain('http://localhost/docs/private-feed')
  }, HTTP_TEST_TIMEOUT_MS)

  test('private wiki page shares expose one read-only page and can be revoked', async () => {
    const { app } = createFixture(undefined, {
      webDist: true,
      env: (env) => ({ ...env, auth: { ...env.auth, privateWiki: true } }),
    })
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')
    const created = await app.handle(
      jsonRequest('/api/pages', {
        path: 'docs/shared',
        title: 'Shared Secret',
        description: 'Only this page is shared',
        content: 'private share body',
      }, admin.token),
    )
    expect(created.status).toBe(200)

    const directAnonymous = await app.handle(new Request('http://localhost/api/page?path=docs/shared'))
    expect(directAnonymous.status).toBe(401)

    const viewerCreate = await app.handle(jsonRequest('/api/page/share', { path: 'docs/shared' }, viewer.token))
    expect(viewerCreate.status).toBe(403)

    const create = await app.handle(jsonRequest('/api/page/share', { path: 'docs/shared' }, admin.token))
    expect(create.status).toBe(200)
    const share = (await create.json()).share as { token: string; path: string }
    expect(share.path).toBe('docs/shared')
    expect(share.token.length).toBeGreaterThan(20)

    const reused = await app.handle(jsonRequest('/api/page/share', { path: 'docs/shared' }, admin.token))
    expect(reused.status).toBe(200)
    expect((await reused.json()).share.token).toBe(share.token)

    const current = await app.handle(new Request('http://localhost/api/page/share?path=docs/shared', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(current.status).toBe(200)
    expect((await current.json()).share.token).toBe(share.token)

    const shared = await app.handle(new Request(`http://localhost/api/shared/${share.token}`))
    expect(shared.status).toBe(200)
    const sharedBody = await shared.json()
    expect(sharedBody.page).toMatchObject({
      path: 'docs/shared',
      title: 'Shared Secret',
      description: 'Only this page is shared',
    })
    expect(sharedBody.page.renderedHtml).toContain('private share body')

    const shareShell = await app.handle(new Request(`http://localhost/_share/${share.token}`))
    expect(shareShell.status).toBe(200)
    const shellHtml = await shareShell.text()
    expect(shellHtml).toContain('<title>Shared Secret · ts-wiki-test</title>')
    expect(shellHtml).toContain('<meta property="og:url" content="http://localhost/_share/')

    const revoked = await app.handle(
      new Request(`http://localhost/api/page/share/${share.token}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${admin.token}` },
      }),
    )
    expect(revoked.status).toBe(200)

    const afterRevoke = await app.handle(new Request(`http://localhost/api/shared/${share.token}`))
    expect(afterRevoke.status).toBe(404)

    const currentAfterRevoke = await app.handle(new Request('http://localhost/api/page/share?path=docs/shared', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(currentAfterRevoke.status).toBe(200)
    expect((await currentAfterRevoke.json()).share).toBeNull()
  }, HTTP_TEST_TIMEOUT_MS)

  test('serves sitemap and robots for anonymous-readable public pages', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    await createPage(app, token, 'docs/sitemap-public', 'public')
    await createPage(app, token, 'secret/sitemap-hidden', 'hidden')
    const rule = await app.handle(
      jsonRequest('/api/admin/page-rules', {
        subjectType: 'anonymous',
        action: 'page:read',
        effect: 'deny',
        matcher: 'prefix',
        pattern: 'secret',
      }, token),
    )
    expect(rule.status).toBe(200)

    const sitemap = await app.handle(new Request('http://localhost/sitemap.xml'))
    expect(sitemap.status).toBe(200)
    expect(sitemap.headers.get('content-type')).toContain('application/xml')
    expect(sitemap.headers.get('cache-control')).toBe('public, max-age=300')
    const xml = await sitemap.text()
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('http://localhost/docs/sitemap-public')
    expect(xml).not.toContain('secret/sitemap-hidden')

    const robots = await app.handle(new Request('http://localhost/robots.txt'))
    expect(robots.status).toBe(200)
    expect(await robots.text()).toBe('User-agent: *\nAllow: /\nSitemap: http://localhost/sitemap.xml\n')
  }, HTTP_TEST_TIMEOUT_MS)

  test('private wiki disables sitemap and disallows robots', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, auth: { ...env.auth, privateWiki: true } }),
    })
    const sitemap = await app.handle(new Request('http://localhost/sitemap.xml'))
    expect(sitemap.status).toBe(404)

    const robots = await app.handle(new Request('http://localhost/robots.txt'))
    expect(robots.status).toBe(200)
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app CORS', () => {
  test('serves DB-aware versioned health and OpenAPI metadata', async () => {
    const { app } = createFixture()
    const health = await app.handle(new Request('http://localhost/api/health'))
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, name: 'kawaii-wiki.ts', version: APP_VERSION })

    const specification = await app.handle(new Request('http://localhost/api/openapi.json'))
    expect(specification.status).toBe(200)
    expect(await specification.json()).toMatchObject({
      info: { title: 'kawaii-wiki.ts API', version: APP_VERSION },
      paths: { '/api/health': expect.any(Object) },
    })
  }, HTTP_TEST_TIMEOUT_MS)

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
    const anonymousWebhook = await app.handle(new Request('http://localhost/api/admin/webhooks'))
    const viewedAutomation = await app.handle(
      new Request('http://localhost/api/admin/automation-rules', {
        headers: { authorization: `Bearer ${viewer.token}` },
      }),
    )
    const viewedApiKeys = await app.handle(
      new Request('http://localhost/api/admin/api-keys', {
        headers: { authorization: `Bearer ${viewer.token}` },
      }),
    )

    expect(anonymous.status).toBe(403)
    expect(viewed.status).toBe(403)
    expect(anonymousWebhook.status).toBe(403)
    expect(viewedAutomation.status).toBe(403)
    expect(viewedApiKeys.status).toBe(403)
  }, HTTP_TEST_TIMEOUT_MS)

  test('admin API keys are named one-time secrets with role-scoped permissions', async () => {
    const { app, db } = createFixture()
    const admin = await register(app, 'admin@example.com')

    const createdViewer = await app.handle(
      jsonRequest('/api/admin/api-keys', {
        name: 'CI backup',
        role: 'viewer',
        expiresAt: Date.now() + 60_000,
      }, admin.token),
    )
    expect(createdViewer.status).toBe(200)
    const viewerBody = await createdViewer.json() as {
      apiKey: { id: string; name: string; role: string; keyHash?: unknown; secret?: unknown }
      secret: string
    }
    expect(viewerBody.secret.startsWith('tswk_')).toBe(true)
    expect(viewerBody.apiKey).toMatchObject({ name: 'CI backup', role: 'viewer' })
    expect(viewerBody.apiKey).not.toHaveProperty('keyHash')
    expect(viewerBody.apiKey).not.toHaveProperty('secret')

    const listed = await app.handle(new Request('http://localhost/api/admin/api-keys', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(listed.status).toBe(200)
    const listBody = await listed.json() as { apiKeys: Array<{ id: string; keyHash?: unknown; secret?: unknown }> }
    expect(listBody.apiKeys).toHaveLength(1)
    expect(listBody.apiKeys[0]).not.toHaveProperty('keyHash')
    expect(listBody.apiKeys[0]).not.toHaveProperty('secret')

    const read = await app.handle(new Request('http://localhost/api/pages', {
      headers: { authorization: `Bearer ${viewerBody.secret}` },
    }))
    expect(read.status).toBe(200)
    const used = db.$client.prepare('SELECT last_used_at AS lastUsedAt FROM api_keys WHERE id = ?').get(viewerBody.apiKey.id) as {
      lastUsedAt: number | null
    }
    expect(typeof used.lastUsedAt).toBe('number')

    const viewerWrite = await app.handle(
      jsonRequest('/api/pages', { path: 'automation/viewer', title: 'Viewer', content: 'no' }, viewerBody.secret),
    )
    expect(viewerWrite.status).toBe(403)
    const viewerAdmin = await app.handle(new Request('http://localhost/api/admin/stats', {
      headers: { authorization: `Bearer ${viewerBody.secret}` },
    }))
    expect(viewerAdmin.status).toBe(403)

    const createdEditor = await app.handle(
      jsonRequest('/api/admin/api-keys', { name: 'Importer', role: 'editor' }, admin.token),
    )
    expect(createdEditor.status).toBe(200)
    const editorBody = await createdEditor.json() as { secret: string }
    const editorWrite = await app.handle(
      jsonRequest('/api/pages', { path: 'automation/editor', title: 'Editor', content: 'ok' }, editorBody.secret),
    )
    expect(editorWrite.status).toBe(200)
  }, HTTP_TEST_TIMEOUT_MS)

  test('revoked and expired API keys cannot authenticate private API reads', async () => {
    const { app, db } = createFixture(undefined, {
      env: (env) => ({ ...env, auth: { ...env.auth, privateWiki: true } }),
    })
    const admin = await register(app, 'admin@example.com')

    const created = await app.handle(
      jsonRequest('/api/admin/api-keys', { name: 'Reader', role: 'viewer' }, admin.token),
    )
    expect(created.status).toBe(200)
    const body = await created.json() as { apiKey: { id: string }; secret: string }

    const beforeRevoke = await app.handle(new Request('http://localhost/api/pages', {
      headers: { authorization: `Bearer ${body.secret}` },
    }))
    expect(beforeRevoke.status).toBe(200)

    const revoked = await app.handle(new Request(`http://localhost/api/admin/api-keys/${body.apiKey.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(revoked.status).toBe(200)

    const afterRevoke = await app.handle(new Request('http://localhost/api/pages', {
      headers: { authorization: `Bearer ${body.secret}` },
    }))
    expect(afterRevoke.status).toBe(401)

    const expiring = await app.handle(
      jsonRequest('/api/admin/api-keys', { name: 'Expiring', role: 'viewer', expiresAt: Date.now() + 60_000 }, admin.token),
    )
    expect(expiring.status).toBe(200)
    const expiringBody = await expiring.json() as { apiKey: { id: string }; secret: string }
    db.$client.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run(Date.now() - 1_000, expiringBody.apiKey.id)

    const afterExpiry = await app.handle(new Request('http://localhost/api/pages', {
      headers: { authorization: `Bearer ${expiringBody.secret}` },
    }))
    expect(afterExpiry.status).toBe(401)
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

  test('search results respect page read deny rules', async () => {
    const { app } = createFixture()
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')

    await createPage(app, admin.token, 'docs/public', 'shared-acl-token public body')
    await createPage(app, admin.token, 'secret/roadmap', 'shared-acl-token secret body')

    const rule = await app.handle(
      jsonRequest('/api/admin/page-rules', {
        subjectType: 'user',
        subjectId: viewer.user.id,
        action: 'page:read',
        effect: 'deny',
        matcher: 'prefix',
        pattern: 'secret',
      }, admin.token),
    )
    expect(rule.status).toBe(200)

    const directRead = await app.handle(new Request('http://localhost/api/page?path=secret/roadmap', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(directRead.status).toBe(403)

    const deniedInsights = await app.handle(new Request('http://localhost/api/page/insights?path=secret/roadmap', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(deniedInsights.status).toBe(403)

    const viewerSearch = await app.handle(new Request('http://localhost/api/search?q=shared-acl-token&limit=10', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(viewerSearch.status).toBe(200)
    const viewerBody = await viewerSearch.json() as { hits: Array<{ path: string; title: string; snippet: string }> }
    expect(viewerBody.hits.map((hit) => hit.path)).toEqual(['docs/public'])
    expect(JSON.stringify(viewerBody.hits)).not.toContain('secret')

    const adminSearch = await app.handle(new Request('http://localhost/api/search?q=shared-acl-token&limit=10', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(adminSearch.status).toBe(200)
    const adminBody = await adminSearch.json() as { hits: Array<{ path: string }> }
    expect(adminBody.hits.map((hit) => hit.path).sort()).toEqual(['docs/public', 'secret/roadmap'])
  }, HTTP_TEST_TIMEOUT_MS)

  test('CJK search queries expose tokenizer guidance and admins can rebuild as trigram', async () => {
    const { app } = createFixture()
    const admin = await register(app, 'admin@example.com')
    await createPage(app, admin.token, 'jp/search', 'これはテストです。天ぷら本文もあります。')

    const search = await app.handle(new Request('http://localhost/api/search?q=%E6%97%A5%E6%9C%AC%E8%AA%9E', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(search.status).toBe(200)
    expect(await search.json()).toMatchObject({
      tokenizerHint: {
        kind: 'cjk-tokenizer',
        tokenizer: 'unicode61',
        recommendedTokenizer: 'trigram',
      },
    })

    const status = await app.handle(new Request('http://localhost/api/admin/search-index', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({
      searchIndex: {
        tokenizer: 'unicode61',
        cjkPages: 1,
        needsTrigram: true,
      },
    })

    const rebuilt = await app.handle(jsonRequest('/api/admin/search-index/rebuild', { tokenizer: 'trigram' }, admin.token))
    expect(rebuilt.status).toBe(200)
    expect(await rebuilt.json()).toMatchObject({
      searchIndex: {
        tokenizer: 'trigram',
        needsTrigram: false,
      },
    })

    const trigramSearch = await app.handle(new Request('http://localhost/api/search?q=%E5%A4%A9%E3%81%B7%E3%82%89', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(trigramSearch.status).toBe(200)
    const trigramBody = await trigramSearch.json() as { hits: Array<{ path: string }>; tokenizerHint?: unknown }
    expect(trigramBody.hits[0]?.path).toBe('jp/search')
    expect(trigramBody.tokenizerHint).toBeUndefined()
  }, HTTP_TEST_TIMEOUT_MS)

  test('trigram search returns one- and two-character CJK substring matches with a hint', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, search: { ftsTokenizer: 'trigram' } }),
    })
    const admin = await register(app, 'admin@example.com')

    const page = await app.handle(
      jsonRequest('/api/pages', {
        path: 'jp/short',
        title: '検索',
        description: '日本語',
        content: '短い語でも見つかります。',
      }, admin.token),
    )
    expect(page.status).toBe(200)

    const twoChars = await app.handle(new Request('http://localhost/api/search?q=%E6%A4%9C%E7%B4%A2', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(twoChars.status).toBe(200)
    expect(await twoChars.json()).toMatchObject({
      hits: [{ path: 'jp/short' }],
      truncatedTerms: ['検索'],
      shortQueryHint: { kind: 'trigram-short-query', tokenizer: 'trigram' },
    })

    const oneChar = await app.handle(new Request('http://localhost/api/search?q=%E8%AA%9E', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(oneChar.status).toBe(200)
    expect(await oneChar.json()).toMatchObject({
      hits: [{ path: 'jp/short' }],
      truncatedTerms: ['語'],
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('Atom feed respects page read deny rules', async () => {
    const { app } = createFixture()
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')

    await createPage(app, admin.token, 'docs/public-feed', 'public feed body')
    await createPage(app, admin.token, 'secret/feed', 'secret feed body')

    const rule = await app.handle(
      jsonRequest('/api/admin/page-rules', {
        subjectType: 'user',
        subjectId: viewer.user.id,
        action: 'page:read',
        effect: 'deny',
        matcher: 'prefix',
        pattern: 'secret',
      }, admin.token),
    )
    expect(rule.status).toBe(200)

    const feed = await app.handle(new Request('http://localhost/feed.xml', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(feed.status).toBe(200)
    const xml = await feed.text()
    expect(xml).toContain('http://localhost/docs/public-feed')
    expect(xml).not.toContain('secret/feed')
  }, HTTP_TEST_TIMEOUT_MS)

  test('recent changes respect page read deny rules and before pagination', async () => {
    const { app } = createFixture()
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')

    await createPage(app, admin.token, 'docs/public-changes', 'public changes body')
    await createPage(app, admin.token, 'secret/changes', 'secret changes body')

    const rule = await app.handle(
      jsonRequest('/api/admin/page-rules', {
        subjectType: 'user',
        subjectId: viewer.user.id,
        action: 'page:read',
        effect: 'deny',
        matcher: 'prefix',
        pattern: 'secret',
      }, admin.token),
    )
    expect(rule.status).toBe(200)

    const changes = await app.handle(new Request('http://localhost/api/changes?limit=10', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(changes.status).toBe(200)
    const body = await changes.json() as { changes: Array<{ id: string; path: string; createdAt: number }> }
    expect(body.changes.map((change) => change.path)).toContain('docs/public-changes')
    expect(body.changes.map((change) => change.path)).not.toContain('secret/changes')

    const before = body.changes[0]?.createdAt
    expect(before).toBeDefined()
    const older = await app.handle(new Request(`http://localhost/api/changes?limit=10&before=${before}`, {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(older.status).toBe(200)
    const olderBody = await older.json() as { changes: Array<{ id: string }> }
    expect(olderBody.changes.map((change) => change.id)).not.toContain(body.changes[0]?.id)
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app settings', () => {
  test('exposes safe public settings and lets admins update them', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const defaults = await app.handle(new Request('http://localhost/api/settings/public'))
    expect(defaults.status).toBe(200)
    expect(await defaults.json()).toMatchObject({
      siteTitle: 'kawaii-wiki.ts',
      accentColor: '#7c3aed',
      homePath: 'home',
      dailyNotesPath: 'journal',
      defaultLocale: 'und',
      timezone: 'UTC',
      dateFormat: 'medium',
      navItems: [
        { key: 'changes', visible: true },
        { key: 'events', visible: true },
        { key: 'graph', visible: true },
        { key: 'redirects', visible: true },
        { key: 'templates', visible: true },
        { key: 'new', visible: true },
      ],
    })

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
          homePath: '/docs/start',
          dailyNotesPath: '/daily/notes',
          defaultLocale: 'ja-JP',
          timezone: 'Asia/Tokyo',
          dateFormat: 'long',
          navLinks: [{
            label: 'Community',
            url: '',
            icon: '!',
            children: [{ label: 'Forum', url: 'https://forum.example', icon: '?' }],
          }],
          navItems: [
            { key: 'new', visible: true },
            { key: 'graph', visible: false },
            { key: 'events', visible: true },
          ],
          logoUrl: '/assets/logo.png',
          faviconUrl: '/assets/favicon.png',
          footerText: 'Licensed under 0BSD',
          footerLinks: [{ label: 'Terms', url: '/terms' }],
          customCss: ':root { --radius: 0.75rem; }',
          customHeadHtml: '<script src="https://analytics.example/script.js"></script>',
          enableMath: true,
          enableEmoji: false,
          enableMermaid: true,
        }),
      }),
    )
    expect(updated.status).toBe(200)

    const publicSettings = await app.handle(new Request('http://localhost/api/settings/public'))
    const settingsBody = await publicSettings.json() as {
      navItems: Array<{ key: string; visible: boolean }>
      navLinks: unknown[]
    }
    expect(settingsBody).toMatchObject({
      siteTitle: 'Docs',
      accentColor: '#2563eb',
      homePath: 'docs/start',
      dailyNotesPath: 'daily/notes',
      defaultLocale: 'ja-jp',
      timezone: 'Asia/Tokyo',
      dateFormat: 'long',
      navLinks: [{
        label: 'Community',
        url: '',
        icon: '!',
        children: [{ label: 'Forum', url: 'https://forum.example', icon: '?' }],
      }],
      logoUrl: '/assets/logo.png',
      faviconUrl: '/assets/favicon.png',
      footerText: 'Licensed under 0BSD',
      footerLinks: [{ label: 'Terms', url: '/terms' }],
      customCss: ':root { --radius: 0.75rem; }',
      customHeadHtml: '',
      enableMath: true,
      enableEmoji: false,
      enableMermaid: true,
    })
    expect(settingsBody.navItems.slice(0, 4)).toEqual([
      { key: 'new', visible: true },
      { key: 'graph', visible: false },
      { key: 'events', visible: true },
      { key: 'changes', visible: true },
    ])
  }, HTTP_TEST_TIMEOUT_MS)

  test('env branding defaults seed public settings and can allow trusted head HTML', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({
        ...env,
        branding: {
          siteTitle: 'Env Wiki',
          accentColor: '#10b981',
          theme: 'dark',
          allowHeadInjection: true,
        },
      }),
    })
    const { token } = await register(app, 'admin@example.com')

    const defaults = await app.handle(new Request('http://localhost/api/settings/public'))
    expect(await defaults.json()).toMatchObject({
      siteTitle: 'Env Wiki',
      accentColor: '#10b981',
      theme: 'dark',
    })

    const updated = await app.handle(
      new Request('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ customHeadHtml: '<meta name="x-test" content="ok">' }),
      }),
    )
    expect(updated.status).toBe(200)

    const publicSettings = await app.handle(new Request('http://localhost/api/settings/public'))
    expect(await publicSettings.json()).toMatchObject({
      customHeadHtml: '<meta name="x-test" content="ok">',
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('env policy defaults seed settings and admin policy changes affect runtime behavior', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({
        ...env,
        auth: {
          ...env.auth,
          registration: 'off',
          privateWiki: true,
          tokenTtlSeconds: 900,
        },
        assetUpload: { maxBytes: 2048 },
      }),
    })

    const seeded = await app.handle(new Request('http://localhost/api/settings/public'))
    expect(await seeded.json()).toMatchObject({
      registration: 'off',
      privateWiki: true,
      tokenTtlSeconds: 900,
      assetMaxBytes: 2048,
      defaultEditorMode: 'visual',
    })

    const admin = await register(app, 'admin@example.com')
    const policy = await app.handle(new Request('http://localhost/api/admin/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({
        registration: 'open',
        privateWiki: false,
        tokenTtlSeconds: 600,
        assetMaxBytes: 1024,
        defaultEditorMode: 'markdown',
      }),
    }))
    expect(policy.status).toBe(200)

    const login = await app.handle(jsonRequest('/api/auth/login', {
      email: 'admin@example.com',
      password: 'password',
    }))
    expect(login.status).toBe(200)
    const loginBody = await login.json() as { token: string }
    const payload = JSON.parse(Buffer.from(loginBody.token.split('.')[1] ?? '', 'base64url').toString()) as {
      exp: number
      iatMs: number
    }
    expect(payload.exp - Math.floor(payload.iatMs / 1000)).toBe(600)

    const locked = await app.handle(new Request('http://localhost/api/admin/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({
        registration: 'off',
        privateWiki: true,
        requireTwoFactor: true,
      }),
    }))
    expect(locked.status).toBe(200)

    const viewer = await app.handle(jsonRequest('/api/auth/register', {
      email: 'viewer@example.com',
      name: 'Viewer',
      password: 'password',
    }))
    expect(viewer.status).toBe(403)

    const pages = await app.handle(new Request('http://localhost/api/pages'))
    expect(pages.status).toBe(401)

    const twoFactor = await app.handle(jsonRequest('/api/auth/login', {
      email: 'admin@example.com',
      password: 'password',
    }))
    expect(twoFactor.status).toBe(202)
    expect(await twoFactor.json()).toMatchObject({ twoFactorSetupRequired: true })

    const form = new FormData()
    form.set('file', new File([new Uint8Array(2048)], 'too-large.png', { type: 'image/png' }))
    const tooLarge = await app.handle(new Request('http://localhost/api/assets', {
      method: 'POST',
      headers: { authorization: `Bearer ${admin.token}` },
      body: form,
    }))
    expect(tooLarge.status).toBe(422)
  }, HTTP_TEST_TIMEOUT_MS)

  test('markdown feature settings affect saved page rendering', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const disabled = await app.handle(jsonRequest('/api/pages', {
      path: 'docs/math-off',
      title: 'Math off',
      content: '$x^2$ :sparkles:',
    }, token))
    expect(disabled.status).toBe(200)
    expect((await disabled.json()).page.renderedHtml).not.toContain('katex')

    const settings = await app.handle(
      new Request('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enableMath: true, enableEmoji: true }),
      }),
    )
    expect(settings.status).toBe(200)

    const enabled = await app.handle(jsonRequest('/api/pages', {
      path: 'docs/math-on',
      title: 'Math on',
      content: '$x^2$ :sparkles:',
    }, token))
    expect(enabled.status).toBe(200)
    const page = (await enabled.json()).page as { renderedHtml: string }
    expect(page.renderedHtml).toContain('katex')
    expect(page.renderedHtml).toContain('✨')
  }, HTTP_TEST_TIMEOUT_MS)

  test('date settings seed page locale and event-card rendering', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({
        ...env,
        localization: { defaultLocale: 'en-gb', timezone: 'Europe/London', dateFormat: 'short' },
      }),
    })
    const { token } = await register(app, 'admin@example.com')

    const defaults = await app.handle(new Request('http://localhost/api/settings/public'))
    expect(await defaults.json()).toMatchObject({
      defaultLocale: 'en-gb',
      timezone: 'Europe/London',
      dateFormat: 'short',
    })

    const settings = await app.handle(
      new Request('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ defaultLocale: 'ja-JP', timezone: 'Asia/Tokyo', dateFormat: 'long' }),
      }),
    )
    expect(settings.status).toBe(200)

    const created = await app.handle(jsonRequest('/api/pages', {
      path: 'events/tokyo',
      title: 'Tokyo planning',
      content: '```event\ntitle: Tokyo planning\nstart: 2026-06-20 10:00\nend: 2026-06-20 11:00\n```',
    }, token))
    expect(created.status).toBe(200)
    const page = (await created.json()).page as { locale: string; renderedHtml: string }
    expect(page.locale).toBe('ja-jp')
    expect(page.renderedHtml).toContain('Asia/Tokyo')
    expect(page.renderedHtml).toContain('ctz=Asia%2FTokyo')
    expect(page.renderedHtml).not.toContain('2026-06-20 10:00')

    const invalidTimezone = await app.handle(
      new Request('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ timezone: 'Mars/Base' }),
      }),
    )
    expect(invalidTimezone.status).toBe(422)

    const invalidLocale = await app.handle(
      new Request('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ defaultLocale: 'not a locale' }),
      }),
    )
    expect(invalidLocale.status).toBe(422)
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app templates', () => {
  test('editors can manage persisted page templates and viewers cannot', async () => {
    const { logger, events } = captureLogger()
    const { app } = createFixture(undefined, { logger })
    const admin = await register(app, 'admin@example.com')
    const editor = await register(app, 'editor@example.com')
    const viewer = await register(app, 'viewer@example.com')

    const viewerList = await app.handle(new Request('http://localhost/api/templates', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(viewerList.status).toBe(403)

    const promoted = await app.handle(
      new Request('http://localhost/api/admin/users/role', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ userId: editor.user.id, role: 'editor' }),
      }),
    )
    expect(promoted.status).toBe(200)

    const created = await app.handle(
      jsonRequest('/api/templates', {
        name: 'Runbook',
        description: 'Incident runbook starter',
        icon: '!',
        content: '# Runbook\n\n## Impact\n',
        metadata: {
          title: 'Runbook',
          path: '/ops/new-runbook',
          labels: ['ops', 'ops'],
          status: 'draft',
          locale: 'en-US',
        },
      }, editor.token),
    )
    expect(created.status).toBe(200)
    const createdBody = await created.json() as { template: { id: string; metadata: { path: string; labels: string[] } } }
    expect(createdBody.template.metadata).toMatchObject({
      path: 'ops/new-runbook',
      labels: ['ops'],
    })

    const listed = await app.handle(new Request('http://localhost/api/templates', {
      headers: { authorization: `Bearer ${editor.token}` },
    }))
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({
      templates: [expect.objectContaining({ name: 'Runbook', content: '# Runbook\n\n## Impact\n' })],
    })

    const updated = await app.handle(
      new Request(`http://localhost/api/templates/${createdBody.template.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${editor.token}` },
        body: JSON.stringify({ name: 'Updated runbook', metadata: { status: 'verified' } }),
      }),
    )
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      template: {
        name: 'Updated runbook',
        metadata: { status: 'verified' },
      },
    })

    const deleted = await app.handle(
      new Request(`http://localhost/api/templates/${createdBody.template.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${editor.token}` },
      }),
    )
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ id: createdBody.template.id })
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'template.create' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'template.update' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'audit', action: 'template.delete' }))
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

  test('webhook retry policy and body limits are configurable', async () => {
    const fetcher: WebhookFetcher = async () =>
      new Response('abcdefghi', { status: 500, statusText: 'upstream response too long' })
    const { app } = createFixture(undefined, {
      webhookFetcher: fetcher,
      env: (env) => ({
        ...env,
        webhooks: {
          ...env.webhooks,
          maxAttempts: 2,
          backoffMs: [1234],
          maxResponseBytes: 5,
          maxErrorBytes: 8,
        },
      }),
    })
    const { token } = await register(app, 'admin@example.com')

    const webhook = await app.handle(
      jsonRequest(
        '/api/admin/webhooks',
        {
          targetUrl: 'https://hooks.example.com/failing',
          secret: 'policy-secret',
          eventTypes: ['page.created'],
        },
        token,
      ),
    )
    expect(webhook.status).toBe(200)
    await createPage(app, token, 'docs/policy-retry', 'retry policy')

    const failed = await app.handle(
      new Request('http://localhost/api/admin/webhooks/deliveries?status=failed', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(failed.status).toBe(200)
    const failedBody = await failed.json() as {
      deliveries: Array<{ id: string; attempts: number; nextAttemptAt: number | null; responseBody: string; error: string }>
    }
    expect(failedBody.deliveries[0]).toMatchObject({
      attempts: 1,
      responseBody: 'abcde',
      error: 'upstream...',
    })
    expect(failedBody.deliveries[0]!.nextAttemptAt).toBeNumber()

    const retry = await app.handle(
      new Request(`http://localhost/api/admin/webhooks/deliveries/${failedBody.deliveries[0]!.id}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({
      delivery: expect.objectContaining({
        status: 'failed',
        attempts: 2,
        nextAttemptAt: null,
        responseBody: 'abcde',
        error: 'upstream...',
      }),
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('webhook subscriptions reject private literal targets unless explicitly allowed', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    const blockedTargets = [
      'http://127.0.0.1:4000/hook',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/hook',
      'http://localhost/hook',
    ]

    for (const targetUrl of blockedTargets) {
      const blocked = await app.handle(
        jsonRequest('/api/admin/webhooks', {
          targetUrl,
          secret: 'blocked-secret',
          eventTypes: ['page.created'],
        }, token),
      )
      expect(blocked.status).toBe(422)
      expect(await blocked.json()).toMatchObject({
        error: { kind: 'validation', field: 'targetUrl' },
      })
    }

    const allowedFixture = createFixture(undefined, {
      env: (env) => ({ ...env, webhooks: { ...env.webhooks, allowPrivateTargets: true } }),
    })
    const allowedAdmin = await register(allowedFixture.app, 'admin@example.com')
    const allowed = await allowedFixture.app.handle(
      jsonRequest('/api/admin/webhooks', {
        targetUrl: 'http://127.0.0.1:4000/hook',
        secret: 'local-secret',
        eventTypes: ['page.created'],
      }, allowedAdmin.token),
    )
    expect(allowed.status).toBe(200)
  }, HTTP_TEST_TIMEOUT_MS)

  test('webhook delivery blocks DNS-rebound private targets before fetch', async () => {
    let calls = 0
    const fetcher: WebhookFetcher = async () => {
      calls += 1
      return new Response('should not be called', { status: 200 })
    }
    const { app } = createFixture(undefined, {
      webhookFetcher: fetcher,
      webhookResolver: async () => ['10.0.0.9'],
    })
    const { token } = await register(app, 'admin@example.com')

    const webhook = await app.handle(
      jsonRequest('/api/admin/webhooks', {
        targetUrl: 'https://hooks.example.com/private',
        secret: 'rebind-secret',
        eventTypes: ['page.created'],
      }, token),
    )
    expect(webhook.status).toBe(200)

    await createPage(app, token, 'docs/rebound', 'blocked before delivery')

    expect(calls).toBe(0)
    const history = await app.handle(
      new Request('http://localhost/api/admin/webhooks/deliveries', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(history.status).toBe(200)
    expect((await history.json()).deliveries[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      responseStatus: null,
      responseBody: null,
      error: expect.stringContaining('resolved to blocked address 10.0.0.9'),
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('webhook delivery validates redirect hops and caps redirect chains', async () => {
    const privateRedirectCalls: string[] = []
    const privateRedirectFetcher: WebhookFetcher = async (url) => {
      privateRedirectCalls.push(url)
      return new Response('', {
        status: 307,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      })
    }
    const privateRedirectFixture = createFixture(undefined, {
      webhookFetcher: privateRedirectFetcher,
      webhookResolver: publicWebhookResolver,
    })
    const privateRedirectAdmin = await register(privateRedirectFixture.app, 'admin@example.com')
    const privateRedirectWebhook = await privateRedirectFixture.app.handle(
      jsonRequest('/api/admin/webhooks', {
        targetUrl: 'https://hooks.example.com/start',
        secret: 'redirect-secret',
        eventTypes: ['page.created'],
      }, privateRedirectAdmin.token),
    )
    expect(privateRedirectWebhook.status).toBe(200)

    await createPage(privateRedirectFixture.app, privateRedirectAdmin.token, 'docs/redirect-private', 'private redirect')

    expect(privateRedirectCalls).toEqual(['https://hooks.example.com/start'])
    const privateRedirectHistory = await privateRedirectFixture.app.handle(
      new Request('http://localhost/api/admin/webhooks/deliveries', {
        headers: { authorization: `Bearer ${privateRedirectAdmin.token}` },
      }),
    )
    expect((await privateRedirectHistory.json()).deliveries[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('private'),
    })

    const redirectLoopCalls: string[] = []
    const redirectLoopFetcher: WebhookFetcher = async (url) => {
      redirectLoopCalls.push(url)
      return new Response('', {
        status: 307,
        headers: { location: '/again' },
      })
    }
    const redirectLoopFixture = createFixture(undefined, {
      webhookFetcher: redirectLoopFetcher,
      webhookResolver: publicWebhookResolver,
    })
    const redirectLoopAdmin = await register(redirectLoopFixture.app, 'admin@example.com')
    const redirectLoopWebhook = await redirectLoopFixture.app.handle(
      jsonRequest('/api/admin/webhooks', {
        targetUrl: 'https://hooks.example.com/loop',
        secret: 'loop-secret',
        eventTypes: ['page.created'],
      }, redirectLoopAdmin.token),
    )
    expect(redirectLoopWebhook.status).toBe(200)

    await createPage(redirectLoopFixture.app, redirectLoopAdmin.token, 'docs/redirect-loop', 'loop redirect')
    await Bun.sleep(10)

    expect(redirectLoopCalls).toHaveLength(6)
    const redirectLoopHistory = await redirectLoopFixture.app.handle(
      new Request('http://localhost/api/admin/webhooks/deliveries', {
        headers: { authorization: `Bearer ${redirectLoopAdmin.token}` },
      }),
    )
    expect((await redirectLoopHistory.json()).deliveries[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('exceeded 5 redirects'),
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

    const created = await app.handle(jsonRequest('/api/pages', {
      path: 'docs/auto',
      title: 'docs/auto',
      content: 'seed',
      status: 'draft',
    }, token))
    expect(created.status).toBe(200)
    const disabledUpdate = await app.handle(
      new Request('http://localhost/api/page?path=docs/auto', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: 'changed once' }),
      }),
    )
    expect(disabledUpdate.status).toBe(200)
    const afterDisabled = await app.handle(new Request('http://localhost/api/page?path=docs/auto', {
      headers: { authorization: `Bearer ${token}` },
    }))
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
    const afterEnabled = await app.handle(new Request('http://localhost/api/page?path=docs/auto', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(await afterEnabled.json()).toMatchObject({
      page: expect.objectContaining({ labels: '["triaged"]', status: 'verified' }),
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('event automation supports triggers, conditions, priority, move, review date, and custom webhook events', async () => {
    const deliveries: WebhookPayload[] = []
    const fetcher: WebhookFetcher = async (_url, init) => {
      deliveries.push(JSON.parse(String(init.body)) as WebhookPayload)
      return new Response('ok', { status: 200 })
    }
    const { app } = createFixture(undefined, { webhookFetcher: fetcher })
    const admin = await register(app, 'admin@example.com')
    const reviewAt = Date.UTC(2026, 6, 1)

    const subscription = await app.handle(
      jsonRequest('/api/admin/webhooks', {
        targetUrl: 'https://hooks.example.com/automation',
        secret: 'automation-secret',
        eventTypes: ['automation.page.ready', 'automation.comment.triaged'],
      }, admin.token),
    )
    expect(subscription.status).toBe(200)

    const createdRule = await app.handle(jsonRequest('/api/admin/automation-rules', {
      name: 'Publish matched launches',
      type: 'event-rule',
      priority: 0,
      stopOnMatch: true,
      config: {
        trigger: 'page.created',
        conditions: {
          pathPrefix: 'drafts',
          authorId: admin.user.id,
          locale: 'ja-JP',
          spaceKey: 'drafts',
        },
        actions: {
          addLabel: 'launched',
          setStatus: 'verified',
          setReviewAt: reviewAt,
          moveToPath: 'published',
          fireWebhookEvent: 'automation.page.ready',
        },
      },
    }, admin.token))
    expect(createdRule.status).toBe(200)

    const skippedRule = await app.handle(jsonRequest('/api/admin/automation-rules', {
      name: 'Skipped by stop flag',
      type: 'event-rule',
      priority: 10,
      config: {
        trigger: 'page.created',
        conditions: { pathPrefix: 'drafts' },
        actions: { addLabel: 'skipped' },
      },
    }, admin.token))
    expect(skippedRule.status).toBe(200)

    const commentRule = await app.handle(jsonRequest('/api/admin/automation-rules', {
      name: 'Comment triage event',
      type: 'event-rule',
      priority: 0,
      config: {
        trigger: 'comment.created',
        conditions: { pathPrefix: 'published', label: 'launched' },
        actions: {
          addLabel: 'commented',
          fireWebhookEvent: 'automation.comment.triaged',
        },
      },
    }, admin.token))
    expect(commentRule.status).toBe(200)

    const created = await app.handle(jsonRequest('/api/pages', {
      path: 'drafts/launch',
      title: 'Launch',
      content: 'ship it',
      locale: 'ja-JP',
    }, admin.token))
    expect(created.status).toBe(200)

    const moved = await app.handle(new Request('http://localhost/api/page?path=published/launch', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(moved.status).toBe(200)
    expect((await moved.json()).page).toMatchObject({
      path: 'published/launch',
      labels: '["launched"]',
      status: 'verified',
      reviewAt,
    })

    const comment = await app.handle(jsonRequest('/api/page/comments', {
      path: 'published/launch',
      body: 'needs release notes',
    }, admin.token))
    expect(comment.status).toBe(200)

    const afterComment = await app.handle(new Request('http://localhost/api/page?path=published/launch', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect((await afterComment.json()).page).toMatchObject({
      labels: '["launched","commented"]',
    })

    expect(deliveries.map((delivery) => delivery.type)).toEqual([
      'automation.page.ready',
      'automation.comment.triaged',
    ])
    expect(deliveries[0]).toMatchObject({
      data: { page: { path: 'published/launch', status: 'verified', labels: ['launched'], reviewAt } },
    })
    expect(deliveries[1]).toMatchObject({
      data: {
        comment: { path: 'published/launch' },
        page: { path: 'published/launch', labels: ['launched', 'commented'] },
      },
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

  test('persists audit events for the admin audit viewer', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    await createPage(app, token, 'docs/audit', 'hello')

    const response = await app.handle(new Request('http://localhost/api/admin/audit?action=page.create', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as {
      total: number
      events: Array<{ action: string; userId: string | null; path: string | null; data: Record<string, unknown> }>
    }
    expect(body.total).toBeGreaterThanOrEqual(1)
    expect(body.events).toContainEqual(expect.objectContaining({
      action: 'page.create',
      path: 'docs/audit',
    }))
  }, HTTP_TEST_TIMEOUT_MS)

  test('can disable audit DB persistence for minimal deployments', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, audit: { ...env.audit, persist: false } }),
    })
    const { token } = await register(app, 'admin@example.com')

    await createPage(app, token, 'docs/audit-disabled', 'hello')

    const response = await app.handle(new Request('http://localhost/api/admin/audit', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as { total: number; events: unknown[] }
    expect(body.total).toBe(0)
    expect(body.events).toEqual([])
  }, HTTP_TEST_TIMEOUT_MS)
})

describe('http app realtime', () => {
  test('SSE events require a readable principal or one-time realtime ticket', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const anonymous = await app.handle(new Request('http://localhost/api/events'))
    expect(anonymous.status).toBe(401)

    const queryToken = await app.handle(new Request(`http://localhost/api/events?token=${token}`))
    expect(queryToken.status).toBe(401)

    const headerResponse = await app.handle(
      new Request('http://localhost/api/events', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(headerResponse.status).toBe(200)
    await headerResponse.body?.cancel()

    const ticket = await realtimeTicket(app, token)
    const response = await app.handle(new Request(`http://localhost/api/events?ticket=${encodeURIComponent(ticket)}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('connected')
    await reader.cancel()

    const reused = await app.handle(new Request(`http://localhost/api/events?ticket=${encodeURIComponent(ticket)}`))
    expect(reused.status).toBe(401)
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
    expect(payload.viewers.some((viewer) => viewer.name === 'Guest')).toBe(true)

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
    const viewerTicket = await realtimeTicket(app, viewer.token)
    const editorTicket = await realtimeTicket(app, token)
    app.listen(0)
    const base = app.server!.url.href.replace(/^http/, 'ws')

    const closed = await new Promise<CloseEvent>((resolve) => {
      const ws = new WebSocket(`${base}api/collab/${encodeURIComponent('docs/ws')}`)
      ws.onclose = (event) => resolve(event)
    })
    expect(closed.code).toBe(1008)

    const viewerClosed = await new Promise<CloseEvent>((resolve) => {
      const ws = new WebSocket(`${base}api/collab/${encodeURIComponent('docs/ws')}?ticket=${encodeURIComponent(viewerTicket)}`)
      ws.onclose = (event) => resolve(event)
    })
    expect(viewerClosed.code).toBe(1008)

    const authed = new WebSocket(`${base}api/collab/${encodeURIComponent('docs/ws')}?ticket=${encodeURIComponent(editorTicket)}`)
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

    const tickets = await Promise.all(Array.from({ length: 8 }, () => realtimeTicket(app, token)))
    const streams = await Promise.all(
      tickets.map((ticket) => app.handle(new Request(`http://localhost/api/events?ticket=${encodeURIComponent(ticket)}`))),
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

    const insights = await app.handle(new Request('http://localhost/api/page/insights?path=docs/target'))
    expect(insights.status).toBe(200)
    expect(await insights.json()).toMatchObject({
      path: 'docs/target',
      views: 1,
      lastViewedAt: expect.any(Number),
      revisionCount: 2,
      contributors: [{
        authorId: expect.any(String),
        authorName: 'admin',
        revisions: 2,
        lastContributionAt: expect.any(Number),
      }],
    })

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

  test('unfurls links for editors and reads YouTube RSS for page readers', async () => {
    const calls: string[] = []
    const { app } = createFixture(undefined, {
      webhookFetcher: async (url) => {
        calls.push(url)
        if (url.includes('/feeds/videos.xml')) {
          return new Response(`<?xml version="1.0" encoding="UTF-8"?>
            <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
              <entry>
                <yt:videoId>video123</yt:videoId>
                <title>Latest stream</title>
                <link rel="alternate" href="https://www.youtube.com/watch?v=video123"/>
                <author><name>Test Channel</name></author>
                <published>2026-07-09T12:00:00+00:00</published>
                <media:group><media:thumbnail url="https://i.ytimg.com/vi/video123/hqdefault.jpg"/></media:group>
              </entry>
            </feed>`, { headers: { 'content-type': 'application/atom+xml' } })
        }
        return new Response(`<!doctype html>
          <html><head>
            <meta property="og:title" content="OG title">
            <meta property="og:description" content="OG description">
            <meta property="og:image" content="https://example.com/og.jpg">
          </head></html>`, { headers: { 'content-type': 'text/html' } })
      },
    })
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')

    const forbiddenPreview = await app.handle(new Request('http://localhost/api/unfurl?url=https://example.com/page', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(forbiddenPreview.status).toBe(403)

    const preview = await app.handle(new Request('http://localhost/api/unfurl?url=https://example.com/page?utm_source=x', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({
      preview: {
        title: 'OG title',
        description: 'OG description',
        image: 'https://example.com/og.jpg',
      },
    })

    const latest = await app.handle(new Request('http://localhost/api/youtube/latest?channelId=UCaaaaaaaaaaaaaaaaaaaaaa&limit=1'))
    expect(latest.status).toBe(200)
    expect(await latest.json()).toMatchObject({
      channel: {
        channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
        videos: [{ id: 'video123', title: 'Latest stream' }],
      },
    })
    expect(calls).toHaveLength(2)
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

    const redirects = await app.handle(new Request('http://localhost/api/redirects', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(redirects.status).toBe(200)
    expect((await redirects.json()).redirects).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromPath: 'docs/old', toPath: 'docs/new' }),
      expect.objectContaining({ fromPath: 'docs/middle', toPath: 'docs/new' }),
    ]))

    const alias = await app.handle(
      jsonRequest('/api/redirects', { fromPath: 'docs/alias', toPath: 'docs/new' }, token),
    )
    expect(alias.status).toBe(200)
    expect(await alias.json()).toMatchObject({
      redirect: { fromPath: 'docs/alias', toPath: 'docs/new' },
    })

    const aliased = await app.handle(new Request('http://localhost/api/page?path=docs/alias'))
    expect(aliased.status).toBe(200)
    expect(await aliased.json()).toMatchObject({
      page: expect.objectContaining({ path: 'docs/new' }),
      redirectedFrom: ['docs/alias'],
    })

    const removed = await app.handle(new Request('http://localhost/api/redirects?fromPath=docs/alias', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ fromPath: 'docs/alias' })
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
    await uploadPngAsset(app, token, 'export-image.png')

    const markdown = await app.handle(new Request('http://localhost/api/export/page?path=docs/export'))
    expect(markdown.status).toBe(200)
    expect(markdown.headers.get('content-type')).toContain('text/markdown')
    expect(await markdown.text()).toContain('title: docs/export')

    const printable = await app.handle(new Request('http://localhost/api/export/page?path=docs/export&format=print'))
    expect(printable.status).toBe(200)
    expect(printable.headers.get('content-disposition')).toContain('inline')
    expect(await printable.text()).toContain('@page{margin:18mm}')

    const site = await app.handle(
      new Request('http://localhost/api/export/site', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(site.status).toBe(200)
    const siteBackup = await site.json() as { pages: Array<Record<string, unknown>> }
    expect(siteBackup.pages).toContainEqual(expect.objectContaining({ path: 'docs/export' }))

    const restored = await app.handle(jsonRequest('/api/import/site', {
      conflictPolicy: 'skip',
      pages: siteBackup.pages,
    }, token))
    expect(restored.status).toBe(200)
    expect((await restored.json()).results).toContainEqual({ path: 'docs/export', ok: true })

    const zip = await app.handle(new Request('http://localhost/api/export/site?format=zip', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(zip.status).toBe(200)
    expect(zip.headers.get('content-type')).toContain('application/zip')
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(strFromU8(entries['content/docs/export.md']!)).toContain('# Export')
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as {
      assets: Array<{ archivePath: string }>
    }
    expect(manifest.assets).toHaveLength(1)
    expect(entries[manifest.assets[0]!.archivePath]).toBeDefined()

    const imported = await app.handle(
      jsonRequest(
        '/api/import/markdown',
        {
          path: 'docs/imported',
          content: '---\ntitle: Imported\ndescription: From file\ntoc: false\ntocDepth: 2\n---\n\n# Imported\n\n## Hidden TOC\n\nHello import',
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
      toc: '[]',
    })
    const importedPage = (await app.handle(new Request('http://localhost/api/page?path=docs/imported', {
      headers: { authorization: `Bearer ${token}` },
    }))).json()
    expect((await importedPage).page.content).toContain('toc: false')
    expect((await importedPage).page.renderedHtml).not.toContain('toc: false')

    const bulk = new FormData()
    bulk.append('files', new File(['---\ntitle: Bulk one\n---\n\n# One\n'], 'bulk-one.md', { type: 'text/markdown' }))
    bulk.append('files', new File([zipSync({
      'content/nested/bulk-two.md': strToU8('---\ntitle: Bulk two\n---\n\n# Two\n'),
    })], 'bulk-pages.zip', { type: 'application/zip' }))
    const bulkImported = await app.handle(new Request('http://localhost/api/import/bulk', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: bulk,
    }))
    expect(bulkImported.status).toBe(200)
    expect((await bulkImported.json()).results).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'bulk-one', ok: true }),
      expect.objectContaining({ path: 'nested/bulk-two', ok: true }),
    ]))
  }, HTTP_TEST_TIMEOUT_MS)

  test('installs and updates bundled official documentation for admins', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    const denied = await app.handle(jsonRequest('/api/import/official-docs', {}))
    expect(denied.status).toBe(403)

    const installed = await app.handle(jsonRequest('/api/import/official-docs', {}, token))
    expect(installed.status).toBe(200)
    const body = await installed.json() as { version: string; results: Array<{ path: string; created: boolean }> }
    expect(body.version).toBe('1.0.3')
    expect(body.results.length).toBeGreaterThanOrEqual(30)
    expect(body.results.every((result) => result.created)).toBe(true)

    const updated = await app.handle(jsonRequest('/api/import/official-docs', {}, token))
    expect(updated.status).toBe(200)
    expect(((await updated.json()) as { results: Array<{ created: boolean }> }).results.every((result) => !result.created)).toBe(true)

    const docsHome = await app.handle(new Request('http://localhost/api/page?path=docs/home', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(docsHome.status).toBe(200)
    expect((await docsHome.json()).page).toMatchObject({ title: 'kawaii-wiki.ts ドキュメント', status: 'verified' })
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
    const listed = (await assets.json()) as { assets: Array<{ id: string; filename: string; url: string; thumbUrl: string | null }> }
    expect(listed.assets).toContainEqual(expect.objectContaining({ filename: 'avatar.png', url: body.url }))
    const listedAsset = listed.assets.find((asset) => asset.filename === 'avatar.png')
    expect(listedAsset?.thumbUrl).toBe(`${body.url}?size=thumb`)
    const thumbUrl = listedAsset!.thumbUrl!

    const thumbResponse = await app.handle(new Request(`http://localhost${thumbUrl}`))
    expect(thumbResponse.status).toBe(200)
    expect(thumbResponse.headers.get('content-type')).toBe('image/webp')
    expect(thumbResponse.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await thumbResponse.arrayBuffer()).byteLength).toBeGreaterThan(0)

    const renamed = await app.handle(
      new Request(`http://localhost/api/assets/${listedAsset!.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ filename: 'renamed.png' }),
      }),
    )
    expect(renamed.status).toBe(200)
    expect((await renamed.json()).asset).toMatchObject({ filename: 'renamed.png', url: body.url })

    const assetId = listedAsset!.id
    const removed = await app.handle(
      new Request(`http://localhost/api/assets/${assetId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(removed.status).toBe(200)
    expect((await removed.json()).asset.deletedAt).toEqual(expect.any(Number))
    expect(existsSync(join(dataDir, body.url))).toBe(true)

    const trash = await app.handle(
      new Request('http://localhost/api/assets/trash', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(trash.status).toBe(200)
    expect(((await trash.json()) as { assets: Array<{ id: string; deletedAt: number | null }> }).assets).toContainEqual(
      expect.objectContaining({ id: assetId, deletedAt: expect.any(Number) }),
    )

    const restored = await app.handle(
      new Request(`http://localhost/api/assets/${assetId}/restore`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(restored.status).toBe(200)
    expect((await restored.json()).asset.deletedAt).toBeNull()

    expect((await app.handle(
      new Request(`http://localhost/api/assets/${assetId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )).status).toBe(200)
    const purged = await app.handle(
      new Request(`http://localhost/api/assets/${assetId}/purge`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(purged.status).toBe(200)
    expect(existsSync(join(dataDir, body.url))).toBe(false)
    expect((await app.handle(new Request(`http://localhost${thumbUrl}`))).status).toBe(404)
  }, HTTP_TEST_TIMEOUT_MS)

  test('organizes assets by normalized folders and filters listings', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    const portrait = await uploadPngAsset(app, token, 'portrait.png', 'Characters / Main ')
    const map = await uploadPngAsset(app, token, 'map.png', 'maps')

    const characterAssets = await app.handle(
      new Request('http://localhost/api/assets?folder=characters/main', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(characterAssets.status).toBe(200)
    expect((await characterAssets.json()) as { assets: Array<{ id: string; filename: string; folder: string }> }).toMatchObject({
      assets: [{ id: portrait.id, filename: 'portrait.png', folder: 'characters/main' }],
    })

    const folders = await app.handle(
      new Request('http://localhost/api/assets/folders', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(folders.status).toBe(200)
    expect((await folders.json()) as { folders: string[] }).toEqual({ folders: ['characters/main', 'maps'] })

    const moved = await app.handle(
      new Request(`http://localhost/api/assets/${portrait.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ folder: 'Characters / Secondary' }),
      }),
    )
    expect(moved.status).toBe(200)
    expect((await moved.json()).asset).toMatchObject({ id: portrait.id, folder: 'characters/secondary' })

    const mapAssets = await app.handle(
      new Request('http://localhost/api/assets?folder=maps', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(mapAssets.status).toBe(200)
    expect((await mapAssets.json()) as { assets: Array<{ id: string; filename: string; folder: string }> }).toMatchObject({
      assets: [{ id: map.id, filename: 'map.png', folder: 'maps' }],
    })
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
    expect(uploads).toHaveLength(2)
    expect(uploads[0]!.storageName).toBe(`assets/${body.id}/avatar.png`)
    expect(uploads[0]!.bytes.byteLength).toBe(png1x1.byteLength)
    expect(uploads[1]!.storageName).toBe(`assets/${body.id}/thumb.webp`)
    expect(uploads[1]!.contentType).toBe('image/webp')
    expect(uploads[1]!.bytes.byteLength).toBeGreaterThan(0)

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
    const listBody = (await listed.json()) as { assets: Array<{ id: string; url: string; storageName: string; thumbUrl: string | null }> }
    expect(listBody.assets[0]).toMatchObject({
      id: body.id,
      url: body.url,
      storageName: uploads[0]!.storageName,
      thumbUrl: `/assets/${uploads[0]!.storageName}?size=thumb`,
    })

    const proxiedThumb = await app.handle(new Request(`http://localhost${listBody.assets[0]!.thumbUrl!}`))
    expect(proxiedThumb.status).toBe(200)
    expect(proxiedThumb.headers.get('content-type')).toBe('image/webp')

    const removed = await app.handle(
      new Request(`http://localhost/api/assets/${body.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(removed.status).toBe(200)
    expect(deletes).toEqual([])
    expect(stored.has(uploads[0]!.storageName)).toBe(true)

    const purged = await app.handle(
      new Request(`http://localhost/api/assets/${body.id}/purge`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(purged.status).toBe(200)
    expect(deletes).toEqual([uploads[0]!.storageName, uploads[1]!.storageName])
    expect(stored.has(uploads[0]!.storageName)).toBe(false)
    expect(stored.has(uploads[1]!.storageName)).toBe(false)
  }, HTTP_TEST_TIMEOUT_MS)

  test('reports page usage for uploaded assets without leaking denied pages', async () => {
    const { app } = createFixture()
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')
    const used = await uploadPngAsset(app, admin.token, 'used.png')
    const hidden = await uploadPngAsset(app, admin.token, 'hidden.png')

    await createPage(app, admin.token, 'docs/asset-usage', `![Used](${used.url})\n[Download](${used.url}?download=1)`)
    await createPage(app, admin.token, 'secret/asset-usage', `![Hidden](${hidden.url})`)

    const denySecret = await app.handle(
      jsonRequest('/api/admin/page-rules', {
        subjectType: 'user',
        subjectId: viewer.user.id,
        action: 'page:read',
        effect: 'deny',
        matcher: 'prefix',
        pattern: 'secret',
      }, admin.token),
    )
    expect(denySecret.status).toBe(200)

    type UsageBody = {
      usage: Array<{
        asset: { id: string; filename: string; url: string }
        pages: Array<{ path: string; title: string }>
      }>
    }
    const pagesFor = (body: UsageBody, assetId: string): Array<{ path: string; title: string }> =>
      body.usage.find((entry) => entry.asset.id === assetId)?.pages ?? []

    const pageUsage = await app.handle(new Request('http://localhost/api/assets/usage?path=docs/asset-usage', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(pageUsage.status).toBe(200)
    const pageUsageBody = await pageUsage.json() as UsageBody
    expect(pagesFor(pageUsageBody, used.id)).toEqual([{ path: 'docs/asset-usage', title: 'docs/asset-usage' }])
    expect(pagesFor(pageUsageBody, hidden.id)).toEqual([])

    const adminUsage = await app.handle(new Request('http://localhost/api/assets/usage', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(adminUsage.status).toBe(200)
    const adminUsageBody = await adminUsage.json() as UsageBody
    expect(pagesFor(adminUsageBody, hidden.id)).toEqual([{ path: 'secret/asset-usage', title: 'secret/asset-usage' }])

    const viewerUsage = await app.handle(new Request('http://localhost/api/assets/usage', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(viewerUsage.status).toBe(200)
    const viewerUsageBody = await viewerUsage.json() as UsageBody
    expect(pagesFor(viewerUsageBody, used.id)).toEqual([{ path: 'docs/asset-usage', title: 'docs/asset-usage' }])
    expect(pagesFor(viewerUsageBody, hidden.id)).toEqual([])

    const deniedBytes = await app.handle(new Request(`http://localhost${hidden.url}`, {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(deniedBytes.status).toBe(404)
    const allowedBytes = await app.handle(new Request(`http://localhost${hidden.url}`, {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(allowedBytes.status).toBe(200)
  }, HTTP_TEST_TIMEOUT_MS)

  test('private wiki requires authentication for asset bytes', async () => {
    const { app } = createFixture(undefined, {
      env: (env) => ({ ...env, auth: { ...env.auth, privateWiki: true } }),
    })
    const admin = await register(app, 'admin@example.com')
    const asset = await uploadPngAsset(app, admin.token, 'private.png')

    expect((await app.handle(new Request(`http://localhost${asset.url}`))).status).toBe(401)
    expect((await app.handle(new Request(`http://localhost${asset.url}`, {
      headers: { authorization: `Bearer ${admin.token}` },
    }))).status).toBe(200)
  }, HTTP_TEST_TIMEOUT_MS)

  test('lists orphaned assets and bulk-deletes only assets that are still orphaned', async () => {
    const { app, dataDir } = createFixture()
    const admin = await register(app, 'admin@example.com')
    const viewer = await register(app, 'viewer@example.com')
    const used = await uploadPngAsset(app, admin.token, 'used.png')
    const orphan = await uploadPngAsset(app, admin.token, 'orphan.png')
    const laterUsed = await uploadPngAsset(app, admin.token, 'later-used.png')

    await createPage(app, admin.token, 'docs/kept-asset', `![Used](${used.url})`)

    const forbiddenOrphans = await app.handle(new Request('http://localhost/api/assets/orphans', {
      headers: { authorization: `Bearer ${viewer.token}` },
    }))
    expect(forbiddenOrphans.status).toBe(403)

    const orphanList = await app.handle(new Request('http://localhost/api/assets/orphans', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(orphanList.status).toBe(200)
    const orphanListBody = await orphanList.json() as { assets: Array<{ id: string; filename: string; url: string }> }
    expect(orphanListBody.assets.map((asset) => asset.id).sort()).toEqual([laterUsed.id, orphan.id].sort())

    await createPage(app, admin.token, 'docs/race-asset', `![Later used](${laterUsed.url})`)
    expect(existsSync(join(dataDir, orphan.url))).toBe(true)

    const cleanup = await app.handle(
      new Request('http://localhost/api/assets/orphans/delete', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${admin.token}`,
        },
        body: JSON.stringify({ ids: [orphan.id, laterUsed.id, used.id] }),
      }),
    )
    expect(cleanup.status).toBe(200)
    const cleanupBody = await cleanup.json() as { assets: Array<{ id: string }>; skipped: number }
    expect(cleanupBody.assets.map((asset) => asset.id)).toEqual([orphan.id])
    expect(cleanupBody.skipped).toBe(2)
    expect(existsSync(join(dataDir, orphan.url))).toBe(true)
    expect(existsSync(join(dataDir, used.url))).toBe(true)
    expect(existsSync(join(dataDir, laterUsed.url))).toBe(true)

    const trash = await app.handle(new Request('http://localhost/api/assets/trash', {
      headers: { authorization: `Bearer ${admin.token}` },
    }))
    expect(trash.status).toBe(200)
    expect(((await trash.json()) as { assets: Array<{ id: string; deletedAt: number | null }> }).assets).toContainEqual(
      expect.objectContaining({ id: orphan.id, deletedAt: expect.any(Number) }),
    )
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

  test('rejects asset uploads whose bytes do not match the declared MIME', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')
    const disguisedHtml = new FormData()
    disguisedHtml.set('file', new File(['<!doctype html><script>alert(1)</script>'], 'avatar.png', {
      type: 'image/png',
    }))

    const response = await app.handle(
      new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: disguisedHtml,
      }),
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { kind: 'validation', field: 'file', message: 'Asset contents do not match the declared type' },
    })
  }, HTTP_TEST_TIMEOUT_MS)

  test('rate limits repeated asset upload attempts', async () => {
    const { app } = createFixture()
    const { token } = await register(app, 'admin@example.com')

    for (let i = 0; i < 20; i += 1) {
      const form = new FormData()
      form.set('file', new File(['<script>alert(1)</script>'], `x-${i}.html`, { type: 'text/html' }))
      const response = await app.handle(
        new Request('http://localhost/api/assets', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: form,
        }),
      )
      expect(response.status).toBe(422)
    }

    const limitedForm = new FormData()
    limitedForm.set('file', new File(['<script>alert(1)</script>'], 'x-limited.html', { type: 'text/html' }))
    const limited = await app.handle(
      new Request('http://localhost/api/assets', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: limitedForm,
      }),
    )
    expect(limited.status).toBe(429)
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

  test('injects per-page SEO tags into the SPA shell for crawlers', async () => {
    const { app } = createFixture(undefined, { webDist: true })
    const { token } = await register(app, 'admin@example.com')
    const created = await app.handle(
      jsonRequest('/api/pages', {
        path: 'docs/seo',
        title: 'SEO & Title',
        description: 'Custom <description>',
        content: 'Intro body\n\n![Cover](/assets/cover.png)',
      }, token),
    )
    expect(created.status).toBe(200)

    const shell = await app.handle(new Request('http://localhost/docs/seo'))
    expect(shell.status).toBe(200)
    const html = await shell.text()
    expect(html).toContain('<title>SEO &amp; Title · ts-wiki-test</title>')
    expect(html).toContain('<meta name="description" content="Custom &lt;description&gt;" />')
    expect(html).toContain('<meta property="og:title" content="SEO &amp; Title · ts-wiki-test" />')
    expect(html).toContain('<meta property="og:url" content="http://localhost/docs/seo" />')
    expect(html).toContain('<meta property="og:image" content="http://localhost/assets/cover.png" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')

    const uiShell = await app.handle(new Request('http://localhost/ui/docs/seo'))
    expect(uiShell.status).toBe(200)
    expect(await uiShell.text()).toContain('<meta property="og:title" content="SEO &amp; Title · ts-wiki-test" />')

    const missingFile = await app.handle(new Request('http://localhost/ui/assets/missing.js'))
    expect(missingFile.status).toBe(404)
  }, HTTP_TEST_TIMEOUT_MS)

  test('uses the configured home page for root shell metadata', async () => {
    const { app } = createFixture(undefined, { webDist: true })
    const { token } = await register(app, 'admin@example.com')

    const settings = await app.handle(
      new Request('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ homePath: 'docs/start' }),
      }),
    )
    expect(settings.status).toBe(200)
    const created = await app.handle(jsonRequest('/api/pages', {
      path: 'docs/start',
      title: 'Custom Home',
      description: 'Root landing page',
      content: 'Welcome home',
    }, token))
    expect(created.status).toBe(200)

    const shell = await app.handle(new Request('http://localhost/'))
    expect(shell.status).toBe(200)
    const html = await shell.text()
    expect(html).toContain('<title>Custom Home · ts-wiki-test</title>')
    expect(html).toContain('<meta name="description" content="Root landing page" />')
  }, HTTP_TEST_TIMEOUT_MS)

  test('keeps private wiki shell metadata generic for anonymous requests', async () => {
    const { app } = createFixture(undefined, {
      webDist: true,
      env: (env) => ({ ...env, auth: { ...env.auth, privateWiki: true } }),
    })
    const { token } = await register(app, 'admin@example.com')
    const created = await app.handle(
      jsonRequest('/api/pages', {
        path: 'docs/private-seo',
        title: 'Private SEO Title',
        description: 'Secret crawler description',
        content: 'secret crawler text',
      }, token),
    )
    expect(created.status).toBe(200)

    const anonymous = await app.handle(new Request('http://localhost/docs/private-seo'))
    expect(anonymous.status).toBe(200)
    const html = await anonymous.text()
    expect(html).toContain('<title>ts-wiki-test</title>')
    expect(html).toContain('<meta name="description" content="ts-wiki-test" />')
    expect(html).not.toContain('Private SEO Title')
    expect(html).not.toContain('Secret crawler description')
    expect(html).not.toContain('secret crawler text')

    const authed = await app.handle(new Request('http://localhost/docs/private-seo', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(authed.status).toBe(200)
    expect(await authed.text()).toContain('<title>Private SEO Title · ts-wiki-test</title>')
  }, HTTP_TEST_TIMEOUT_MS)
})
