/**
 * PostgreSQL end-to-end app boot — integration. Env-gated.
 *
 * The acceptance proof for #364: the full HTTP app, wired through
 * `createPostgresDatabaseAdapter`, serves real requests against Postgres — health,
 * the setup gate, first-user registration, and a page create/read round-trip.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../http/app.ts'
import { createPostgresDatabaseAdapter } from '../../http/postgres-adapter.ts'
import { testEnv } from '../../http/test-support.ts'
import type { StructuredLogger } from '../../observability/logging.ts'
import { createPostgresContractDb, testPostgresUrl, type PostgresContractDb } from './test-support.ts'

const noopLogger: StructuredLogger = { info: () => {}, warn: () => {}, error: () => {} }

const post = (path: string, body: unknown, token?: string): Request =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

describe.skipIf(!testPostgresUrl)('postgres app boot', () => {
  let harness: PostgresContractDb
  let dataDir: string
  beforeAll(async () => { harness = await createPostgresContractDb('kw_pg_app_boot') })
  beforeEach(async () => {
    await harness.reset()
    dataDir = mkdtempSync(join(tmpdir(), 'kw-pg-app-'))
    mkdirSync(join(dataDir, 'assets'), { recursive: true })
  })
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }) })
  afterAll(async () => { await harness?.close() })

  test('serves health, the setup gate, and a full page lifecycle over Postgres', async () => {
    const app = createApp({
      database: createPostgresDatabaseAdapter(harness.client),
      env: testEnv(dataDir),
      logger: noopLogger,
    })

    // Health probe reaches Postgres.
    const health = await app.handle(new Request('http://localhost/api/health'))
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true })

    // Fresh schema → setup required.
    const before = await app.handle(new Request('http://localhost/api/setup/status'))
    expect(await before.json()).toEqual({ needsSetup: true })

    // First registration bootstraps the admin.
    const registered = await app.handle(post('/api/auth/register', { email: 'admin@example.com', name: 'Admin', password: 'password' }))
    expect(registered.status).toBe(200)
    const { token, user } = await registered.json() as { token: string; user: { role: string } }
    expect(user.role).toBe('admin')

    // Setup gate closes once the admin exists.
    const after = await app.handle(new Request('http://localhost/api/setup/status'))
    expect(await after.json()).toEqual({ needsSetup: false })

    // Create a page and read it back through the service layer.
    const created = await app.handle(post('/api/pages', { path: 'docs/pg', title: 'PG', content: 'hello from postgres', status: 'verified' }, token))
    expect(created.status).toBe(200)

    const read = await app.handle(new Request('http://localhost/api/page?path=docs/pg', {
      headers: { authorization: `Bearer ${token}` },
    }))
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ page: { content: 'hello from postgres' } })
  })
})
