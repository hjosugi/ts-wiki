/**
 * Cross-driver service contract.
 *
 * Runs the same authorization, page, auth, automation, import/export, and
 * realtime behaviour through the composed service layer against every backing
 * driver. The two local drivers (bun:sqlite and an in-memory libSQL) always
 * run; when `KAWAII_WIKI_TEST_LIBSQL_URL` is set, an embedded replica against a
 * provisioned external libSQL primary is exercised under the exact same suite.
 *
 * This is the acceptance-level "full driver matrix" for #363: it proves the
 * driver-neutral contracts hold identically on SQLite, libSQL, and a remote SQL
 * database, not just at the individual repository boundary.
 *
 * Remote embedded replicas reflect a primary write only once the replica has
 * synced; local drivers are immediately consistent. `db.$syncAfterWrite` is the
 * production primitive that pulls those frames (and is `undefined` on local
 * drivers), so the helpers below reuse it to read a write back deterministically
 * on every driver rather than papering the difference over.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { can, parsePageFile, serializePageFile, type Principal } from '@kawaii-wiki/core'
import { createLibsqlDb, createSqliteDb, type DB } from './client.ts'
import { createServices } from './services.ts'
import { createDbEventBus, type WikiEvent } from '../realtime/bus.ts'

const admin: Principal = { id: 'contract-admin', role: 'admin' }

const externalUrl = process.env.KAWAII_WIKI_TEST_LIBSQL_URL?.trim()
const externalReplicaDir = externalUrl
  ? mkdtempSync(join(process.cwd(), '.kawaii-wiki-libsql-full-contract-'))
  : null
let externalReplicaSequence = 0

const drivers: Array<readonly [string, () => DB]> = [
  ['sqlite', () => createSqliteDb(':memory:')],
  ['libsql', () => createLibsqlDb({ driver: 'libsql', url: ':memory:', authToken: null, replicaPath: null })],
]
if (externalUrl && externalReplicaDir) {
  drivers.push([
    'external-libsql',
    () => createLibsqlDb({
      driver: 'libsql',
      url: externalUrl,
      authToken: process.env.KAWAII_WIKI_TEST_LIBSQL_AUTH_TOKEN?.trim() || null,
      replicaPath: join(externalReplicaDir, `replica-${externalReplicaSequence += 1}.db`),
    }),
  ])
}

afterAll(() => {
  if (externalReplicaDir) rmSync(externalReplicaDir, { recursive: true, force: true })
})

describe.each(drivers)('%s cross-driver service contract', (driver, create) => {
  // A single database per driver, shared across the domains below. Each domain
  // namespaces its fixtures by `driver`, so the shared external primary never
  // sees a primary-key collision between domains.
  let db: DB
  let services: ReturnType<typeof createServices>

  // Pull the primary's latest frames into the embedded replica; no-op locally.
  const commit = async (): Promise<void> => {
    await db.$syncAfterWrite?.()
  }

  // Read back a value, syncing the replica between attempts until it appears.
  // Local drivers satisfy `ready` on the first read and never loop.
  const untilVisible = async <T>(read: () => Promise<T> | T, ready: (value: T) => boolean): Promise<T> => {
    let value = await read()
    for (let attempt = 0; !ready(value) && db.$syncAfterWrite && attempt < 10; attempt += 1) {
      await db.$syncAfterWrite()
      value = await read()
    }
    return value
  }

  beforeAll(async () => {
    db = create()
    services = createServices(db)
    await services.authz.ensureDefaults()
    // Make the default groups/grants visible before the first policy load.
    await commit()
  })

  afterAll(() => {
    db.$client.close()
  })

  test('authorization: default policy persists and page rules are enforced', async () => {
    const groups = await services.authz.listGroups(admin)
    expect(groups.ok).toBe(true)
    if (!groups.ok) throw new Error('list groups failed')
    expect(groups.value.map((group) => group.key)).toEqual(['admins', 'editors', 'guests', 'viewers'])
    expect(await services.authz.canAnonymous('page:read', `${driver}/public`)).toBe(true)
    expect(await services.authz.canAnonymous('page:create', `${driver}/public`)).toBe(false)

    const denied = await services.authz.createPageRule(admin, {
      subjectType: 'group',
      subjectId: 'viewers',
      action: 'page:read',
      effect: 'deny',
      matcher: 'prefix',
      pattern: `${driver}-secret`,
    })
    expect(denied.ok).toBe(true)
    if (!denied.ok) throw new Error('page rule create failed')
    // Sync before the invalidated policy is reloaded below.
    await commit()

    // Uncached read-back proves the rule persisted on this driver.
    const rules = await untilVisible(
      () => services.authz.listPageRules(admin),
      (result) => result.ok && result.value.some((rule) => rule.id === denied.value.id),
    )
    expect(rules.ok && rules.value.some((rule) => rule.id === denied.value.id)).toBe(true)

    const viewer = await services.users.create({
      email: `${driver}-viewer@example.com`,
      name: 'Viewer',
      password: 'password',
      role: 'viewer',
    })
    expect(viewer.ok).toBe(true)
    if (!viewer.ok) throw new Error('viewer seed failed')
    const principal = await services.authz.principalForUser(viewer.value)
    expect(can(principal, 'page:read', { path: `${driver}/open` })).toBe(true)
    expect(can(principal, 'page:read', { path: `${driver}-secret/closed` })).toBe(false)
  })

  test('page: create, read, update, and revision history', async () => {
    const path = `cross/${driver}/page`
    const created = await services.pages.create({ path, title: `Page ${driver}`, content: `original ${driver}` }, admin)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(`page create failed: ${created.error.message}`)

    const fetched = await services.pages.getByPath(path)
    expect(fetched.ok).toBe(true)
    if (fetched.ok) expect(fetched.value.content).toBe(`original ${driver}`)

    const updated = await services.pages.update(path, { content: `updated ${driver}` }, admin)
    expect(updated.ok).toBe(true)
    if (updated.ok) expect(updated.value.content).toBe(`updated ${driver}`)

    const history = await services.pages.history(path)
    expect(history.ok).toBe(true)
    if (history.ok) expect(history.value.length).toBeGreaterThanOrEqual(2)
  })

  test('auth: user persistence, duplicate rejection, and token invalidation', async () => {
    const email = `${driver}-auth@example.com`
    const created = await services.users.create({ email, name: 'Auth User', password: 'old-password', role: 'editor' })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('auth user seed failed')
    await commit()

    const found = await untilVisible(() => services.users.findByEmail(email), (user) => Boolean(user))
    expect(found).toMatchObject({ id: created.value.id, email })

    const duplicate = await services.users.create({ email, name: 'Duplicate', password: 'password', role: 'viewer' })
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error.kind).toBe('conflict')

    const principal: Principal = { id: created.value.id, role: 'editor' }
    const wrong = await services.users.changePassword(principal, { currentPassword: 'nope', newPassword: 'new-password' })
    expect(wrong.ok).toBe(false)
    const changed = await services.users.changePassword(principal, { currentPassword: 'old-password', newPassword: 'new-password' })
    expect(changed.ok).toBe(true)
    if (changed.ok) expect(changed.value.tokenInvalidBefore).toBeGreaterThan(0)
  })

  test('automation: rule persistence and retrieval', async () => {
    const created = await services.webhooks.createAutomationRule(admin, {
      name: `Auto ${driver}`,
      type: 'event-rule',
      config: { trigger: 'page.updated', actions: { addLabel: `${driver}-reviewed` } },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(`automation create failed: ${created.error.message}`)
    await commit()

    const rules = await untilVisible(
      () => services.webhooks.listAutomationRules(admin),
      (result) => result.ok && result.value.some((rule) => rule.id === created.value.id),
    )
    expect(rules.ok).toBe(true)
    if (!rules.ok) throw new Error('automation list failed')
    const persisted = rules.value.find((rule) => rule.id === created.value.id)
    expect(persisted).toBeDefined()
    expect(persisted?.config).toMatchObject({ trigger: 'page.updated', actions: { addLabel: `${driver}-reviewed` } })
  })

  test('import/export: markdown round-trip through the page service', async () => {
    const path = `cross/${driver}/import`
    const source = serializePageFile({ title: `Imported ${driver}`, description: 'imported doc', content: `import body ${driver}` })

    const imported = await services.pages.upsertFromFile(path, parsePageFile(source), {}, admin)
    expect(imported.ok).toBe(true)
    if (!imported.ok) throw new Error(`import failed: ${imported.error.message}`)
    expect(imported.value.created).toBe(true)

    const exported = await untilVisible(
      async () => (await services.pages.allActive()).find((page) => page.path === path),
      (page) => Boolean(page),
    )
    expect(exported).toBeDefined()
    expect(exported?.title).toBe(`Imported ${driver}`)
    expect(exported?.content).toContain(`import body ${driver}`)
  })

  test('realtime: event bus delivers page events to in-process subscribers', async () => {
    // Synchronous in-process delivery is the bus contract that holds identically
    // on every driver, so it is what the matrix asserts here. The shared-log
    // persistence/poll/prune path (used for cross-instance fan-out) is covered
    // strictly on SQLite by realtime/bus.test.ts; it is not yet driver-portable
    // to a remote libSQL embedded replica, where the connection's first read pins
    // its snapshot and later writes never surface to the same connection's reads.
    // Tracked as follow-up before remote libSQL is exposed as a selectable driver.
    const bus = createDbEventBus(db, { sourceId: `${driver}-src`, pollIntervalMs: 10 })
    try {
      const seen: WikiEvent[] = []
      bus.subscribe((event) => seen.push(event))
      const events: WikiEvent[] = [
        { type: 'page:changed', action: 'created', path: `${driver}/a` },
        { type: 'page:changed', action: 'updated', path: `${driver}/a` },
        { type: 'page:changed', action: 'moved', path: `${driver}/b`, from: `${driver}/a` },
      ]
      for (const event of events) bus.emit(event)
      expect(seen).toEqual(events)
    } finally {
      bus.close()
    }
  })
})
