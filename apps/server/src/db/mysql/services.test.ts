/**
 * MySQL composed-service contract test — integration. Env-gated.
 *
 * Composes the full service layer with `createMysqlServices` against a real
 * database and drives the same domains the cross-driver matrix asserts
 * (authorization, page, auth, automation, import/export), proving the MySQL
 * composition root wires all 22 repositories + page writes correctly. Realtime
 * is excluded — the DB event bus is SQLite-typed and gets its own MySQL slice;
 * search is the placeholder indexer (empty results) until the FULLTEXT slice, so
 * it is not exercised here. Tests share one database and use distinct paths and
 * emails instead of resetting between them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { can, parsePageFile, serializePageFile, type Principal } from '@kawaii-wiki/core'
import { createMysqlContractDb, testMysqlUrl, type MysqlContractDb } from './test-support.ts'
import { createMysqlServices } from './services.ts'
import type { Services } from '../../services/index.ts'

describe.skipIf(!testMysqlUrl)('mysql composed services', () => {
  let harness: MysqlContractDb
  let services: Services
  const admin: Principal = { id: 'contract-admin', role: 'admin' }

  beforeAll(async () => {
    harness = await createMysqlContractDb('kw_services_contract')
    services = createMysqlServices(harness.client)
    await services.authz.ensureDefaults()
  }, 30_000)
  afterAll(async () => {
    await harness?.close()
  }, 30_000)

  test('health: the connectivity probe resolves', async () => {
    await expect(services.ping()).resolves.toBeUndefined()
  })

  test('authorization: default policy, page rules, and user principals', async () => {
    const groups = await services.authz.listGroups(admin)
    expect(groups.ok).toBe(true)
    if (!groups.ok) throw new Error('listGroups failed')
    expect(groups.value.map((group) => group.key)).toEqual(['admins', 'editors', 'guests', 'viewers'])
    expect(await services.authz.canAnonymous('page:read', 'public')).toBe(true)
    expect(await services.authz.canAnonymous('page:create', 'public')).toBe(false)

    const denied = await services.authz.createPageRule(admin, {
      subjectType: 'group', subjectId: 'viewers', action: 'page:read', effect: 'deny', matcher: 'prefix', pattern: 'secret',
    })
    expect(denied.ok).toBe(true)
    const rules = await services.authz.listPageRules(admin)
    expect(rules.ok && rules.value.some((rule) => rule.pattern === 'secret')).toBe(true)

    const viewer = await services.users.create({ email: 'viewer@example.com', name: 'Viewer', password: 'password', role: 'viewer' })
    expect(viewer.ok).toBe(true)
    if (!viewer.ok) throw new Error('viewer seed failed')
    const principal = await services.authz.principalForUser(viewer.value)
    expect(can(principal, 'page:read', { path: 'open' })).toBe(true)
    expect(can(principal, 'page:read', { path: 'secret/closed' })).toBe(false)
  })

  test('page: create, read, update, and revision history', async () => {
    const path = 'cross/mysql/page'
    const created = await services.pages.create({ path, title: 'Page', content: 'original' }, admin)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(`page create failed: ${created.error.message}`)

    const fetched = await services.pages.getByPath(path)
    expect(fetched.ok).toBe(true)
    if (fetched.ok) expect(fetched.value.content).toBe('original')

    const updated = await services.pages.update(path, { content: 'updated' }, admin)
    expect(updated.ok).toBe(true)
    if (updated.ok) expect(updated.value.content).toBe('updated')

    const history = await services.pages.history(path)
    expect(history.ok).toBe(true)
    if (history.ok) expect(history.value.length).toBeGreaterThanOrEqual(2)
  })

  test('auth: user persistence, duplicate rejection, and password change', async () => {
    const email = 'mysql-auth@example.com'
    const created = await services.users.create({ email, name: 'Auth User', password: 'old-password', role: 'editor' })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('auth user seed failed')

    expect(await services.users.findByEmail(email)).toMatchObject({ id: created.value.id, email })

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
      name: 'Auto', type: 'event-rule', config: { trigger: 'page.updated', actions: { addLabel: 'reviewed' } },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(`automation create failed: ${created.error.message}`)

    const rules = await services.webhooks.listAutomationRules(admin)
    expect(rules.ok).toBe(true)
    if (!rules.ok) throw new Error('automation list failed')
    const persisted = rules.value.find((rule) => rule.id === created.value.id)
    expect(persisted?.config).toMatchObject({ trigger: 'page.updated', actions: { addLabel: 'reviewed' } })
  })

  test('import/export: markdown round-trip through the page service', async () => {
    const path = 'cross/mysql/import'
    const source = serializePageFile({ title: 'Imported', description: 'imported doc', content: 'import body' })

    const imported = await services.pages.upsertFromFile(path, parsePageFile(source), {}, admin)
    expect(imported.ok).toBe(true)
    if (!imported.ok) throw new Error(`import failed: ${imported.error.message}`)
    expect(imported.value.created).toBe(true)

    const exported = (await services.pages.allActive()).find((page) => page.path === path)
    expect(exported?.title).toBe('Imported')
    expect(exported?.content).toContain('import body')
  })
})
