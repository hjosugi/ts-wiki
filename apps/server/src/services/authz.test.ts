import { describe, expect, test } from 'bun:test'
import { can, type Principal, type Role } from '@kawaii-wiki/core'
import { createDb } from '../db/client.ts'
import { createSqliteAuthzRepository } from '../db/repositories/authz.ts'
import { createAuthzService } from './authz.ts'
import { createServices } from '../db/services.ts'

const admin: Principal = { id: 'admin-1', role: 'admin' }

const seedUser = async (role: Role = 'viewer') => {
  const services = createServices(createDb(':memory:'))
  const created = await services.users.create({
    email: `${role}@example.com`,
    name: `${role} user`,
    password: 'password',
    role,
  })
  if (!created.ok) throw new Error('user seed failed')
  return { services, user: created.value }
}

describe('authz service', () => {
  test('ensureDefaults creates role groups and anonymous read grants', async () => {
    const { authz } = createServices(createDb(':memory:'))

    await authz.ensureDefaults()

    const groups = await authz.listGroups(admin)
    expect(groups.ok).toBe(true)
    if (!groups.ok) throw new Error('list groups failed')
    expect(groups.value.map((group) => group.key)).toEqual(['admins', 'editors', 'guests', 'viewers'])
    expect(await authz.canAnonymous('page:read', 'docs/public')).toBe(true)
    expect(await authz.canAnonymous('page:create', 'docs/public')).toBe(false)
  })

  test('syncRoleGroup keeps the default role group in sync', async () => {
    const { services, user } = await seedUser('editor')

    await services.authz.syncRoleGroup(user.id, 'editor')
    const editorPrincipal = await services.authz.principalForUser(user)
    expect(editorPrincipal.groups).toContain('editors')
    expect(editorPrincipal.groups).not.toContain('viewers')

    await services.authz.syncRoleGroup(user.id, 'viewer')
    const viewerPrincipal = await services.authz.principalForUser({ ...user, role: 'viewer' })
    expect(viewerPrincipal.groups).toContain('viewers')
    expect(viewerPrincipal.groups).not.toContain('editors')
  })

  test('custom membership changes are reflected in principalForUser', async () => {
    const { services, user } = await seedUser('viewer')

    const createdGroup = await services.authz.createGroup(admin, {
      key: 'Docs Team',
      name: 'Docs Team',
      description: 'Documentation maintainers',
    })
    expect(createdGroup.ok).toBe(true)
    if (!createdGroup.ok) throw new Error('group create failed')
    expect(createdGroup.value.key).toBe('docs-team')

    const added = await services.authz.addUserToGroup(admin, user.id, 'docs-team')
    expect(added.ok).toBe(true)
    expect((await services.authz.principalForUser(user)).groups).toContain('docs-team')

    const removed = await services.authz.removeUserFromGroup(admin, user.id, 'docs-team')
    expect(removed.ok).toBe(true)
    expect((await services.authz.principalForUser(user)).groups).not.toContain('docs-team')
  })

  test('assembled page-rule policy applies matcher specificity', async () => {
    const { services, user } = await seedUser('viewer')

    const denied = await services.authz.createPageRule(admin, {
      subjectType: 'group',
      subjectId: 'viewers',
      action: 'page:read',
      effect: 'deny',
      matcher: 'prefix',
      pattern: 'secret',
    })
    expect(denied.ok).toBe(true)
    const allowed = await services.authz.createPageRule(admin, {
      subjectType: 'group',
      subjectId: 'viewers',
      action: 'page:read',
      effect: 'allow',
      matcher: 'exact',
      pattern: 'secret/open',
    })
    expect(allowed.ok).toBe(true)

    const principal = await services.authz.principalForUser(user)
    expect(principal.policy?.pageRules?.length).toBe(2)
    expect(can(principal, 'page:read', { path: 'public/page' })).toBe(true)
    expect(can(principal, 'page:read', { path: 'secret/closed' })).toBe(false)
    expect(can(principal, 'page:read', { path: 'secret/open' })).toBe(true)
  })

  test('deduplicates concurrent remote-style policy loads', async () => {
    const db = createDb(':memory:')
    const repository = createSqliteAuthzRepository(db)
    let grantLoads = 0
    let ruleLoads = 0
    const authz = createAuthzService({
      ...repository,
      async listPermissionGrants() {
        grantLoads += 1
        await Promise.resolve()
        return repository.listPermissionGrants()
      },
      async listPageRules() {
        ruleLoads += 1
        await Promise.resolve()
        return repository.listPageRules()
      },
    })

    expect((await Promise.all(Array.from({ length: 20 }, () => authz.canAnonymous('page:read', 'docs')))).every(Boolean)).toBe(true)
    expect(grantLoads).toBe(1)
    expect(ruleLoads).toBe(1)
  })
})
