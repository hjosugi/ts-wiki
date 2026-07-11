import { and, asc, eq, sql } from 'drizzle-orm'
import {
  type Action,
  type AppError,
  type PageRuleMatcher,
  type PermissionEffect,
  type PermissionGrant,
  type PermissionPolicy,
  type PermissionSubjectType,
  type Principal,
  type Result,
  type Role,
  can,
  conflict,
  err,
  normalizePath,
  ok,
  requirePermission,
  validationError,
} from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import { isUniqueConstraintError } from '../db/errors.ts'
import {
  groupMemberships,
  groups,
  pageRules,
  permissionGrants,
  type Group,
  type PageRuleRow,
  type PermissionGrantRow,
  type User,
} from '../db/schema.ts'

export interface AuthzGroupView {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly description: string
  readonly members: number
  readonly createdAt: number
}

export interface CreateGroupInput {
  readonly key: string
  readonly name: string
  readonly description?: string
}

export interface UpsertPageRuleInput {
  readonly subjectType: PermissionSubjectType
  readonly subjectId?: string | null
  readonly action: Action
  readonly effect: PermissionEffect
  readonly matcher: PageRuleMatcher
  readonly pattern: string
}

export interface AuthzService {
  ensureDefaults(): void
  principalForUser(user: User): Principal
  principalForApiKey(apiKeyId: string, role: Role): Principal
  canAnonymous(action: Action, path?: string): boolean
  syncRoleGroup(userId: string, role: Role): void
  listGroups(principal: Principal | null): Result<AuthzGroupView[], AppError>
  createGroup(principal: Principal | null, input: CreateGroupInput): Result<AuthzGroupView, AppError>
  addUserToGroup(principal: Principal | null, userId: string, groupKey: string): Result<{ userId: string; groupKey: string }, AppError>
  removeUserFromGroup(principal: Principal | null, userId: string, groupKey: string): Result<{ userId: string; groupKey: string }, AppError>
  listPageRules(principal: Principal | null): Result<PageRuleRow[], AppError>
  createPageRule(principal: Principal | null, input: UpsertPageRuleInput): Result<PageRuleRow, AppError>
  deletePageRule(principal: Principal | null, id: string): Result<{ id: string }, AppError>
}

const ROLE_GROUPS: Record<Role, string> = {
  admin: 'admins',
  editor: 'editors',
  viewer: 'viewers',
}

const DEFAULT_GROUPS: Array<{ key: string; name: string; description: string }> = [
  { key: 'admins', name: 'Admins', description: 'Full site administration and content access.' },
  { key: 'editors', name: 'Editors', description: 'Create, update, move, and delete wiki content.' },
  { key: 'viewers', name: 'Viewers', description: 'Read wiki content.' },
  { key: 'guests', name: 'Guests', description: 'Anonymous public access.' },
]

const DEFAULT_ACTIONS: Record<'viewers' | 'editors' | 'admins' | 'guests', readonly Action[]> = {
  guests: ['page:read', 'asset:read', 'search:read'],
  viewers: ['page:read', 'asset:read', 'comment:read', 'comment:write', 'search:read'],
  editors: [
    'page:read',
    'page:create',
    'page:update',
    'page:write',
    'page:delete',
    'page:move',
    'asset:read',
    'asset:write',
    'asset:delete',
    'comment:read',
    'comment:write',
    'search:read',
  ],
  admins: [
    'page:read',
    'page:create',
    'page:update',
    'page:write',
    'page:delete',
    'page:move',
    'asset:read',
    'asset:write',
    'asset:delete',
    'comment:read',
    'comment:write',
    'search:read',
    'git:sync',
    'automation:manage',
    'admin:access',
  ],
}

const ACTIONS = new Set<Action>(Object.values(DEFAULT_ACTIONS).flat())
const EFFECTS = new Set<PermissionEffect>(['allow', 'deny'])
const SUBJECT_TYPES = new Set<PermissionSubjectType>(['user', 'group', 'anonymous'])
const MATCHERS = new Set<PageRuleMatcher>(['exact', 'prefix', 'suffix', 'regex'])

const isAction = (value: string): value is Action => ACTIONS.has(value as Action)
const isEffect = (value: string): value is PermissionEffect => EFFECTS.has(value as PermissionEffect)
const isSubjectType = (value: string): value is PermissionSubjectType => SUBJECT_TYPES.has(value as PermissionSubjectType)
const isMatcher = (value: string): value is PageRuleMatcher => MATCHERS.has(value as PageRuleMatcher)

const cleanKey = (value: string): string => normalizePath(value).replace(/\//g, '-').slice(0, 80)

const toGrant = (row: PermissionGrantRow): PermissionGrant | null =>
  isSubjectType(row.subjectType) && isAction(row.action) && isEffect(row.effect)
    ? {
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        action: row.action,
        effect: row.effect,
      }
    : null

const toPolicyRule = (row: PageRuleRow) =>
  isSubjectType(row.subjectType) && isAction(row.action) && isEffect(row.effect) && isMatcher(row.matcher)
    ? {
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        action: row.action,
        effect: row.effect,
        matcher: row.matcher,
        pattern: row.pattern,
      }
    : null

export const createAuthzService = (db: DB): AuthzService => {
  let defaultsReady = false
  let cachedPolicy: PermissionPolicy | null = null
  const findGroup = (key: string): Group | undefined =>
    db.select().from(groups).where(eq(groups.key, cleanKey(key))).get()

  const insertDefaultGrant = (subjectType: PermissionSubjectType, subjectId: string | null, action: Action): void => {
    const existing = db
      .select({ id: permissionGrants.id })
      .from(permissionGrants)
      .where(
        and(
          eq(permissionGrants.subjectType, subjectType),
          subjectId === null ? sql`${permissionGrants.subjectId} IS NULL` : eq(permissionGrants.subjectId, subjectId),
          eq(permissionGrants.action, action),
          eq(permissionGrants.effect, 'allow'),
        ),
      )
      .get()
    if (existing) return
    db.insert(permissionGrants)
      .values({
        id: crypto.randomUUID(),
        subjectType,
        subjectId,
        action,
        effect: 'allow',
        createdAt: Date.now(),
      })
      .run()
  }

  const groupsForUser = (userId: string, role: Role): string[] => {
    const rows = db
      .select({ key: groups.key })
      .from(groupMemberships)
      .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
      .where(eq(groupMemberships.userId, userId))
      .all()
    return [...new Set([ROLE_GROUPS[role], ...rows.map((row) => row.key)])]
  }

  const policy = (): PermissionPolicy => {
    if (cachedPolicy) return cachedPolicy
    const grants = db.select().from(permissionGrants).all().map(toGrant).filter((grant): grant is PermissionGrant => Boolean(grant))
    const rules = db.select().from(pageRules).all().map(toPolicyRule).filter((rule): rule is NonNullable<ReturnType<typeof toPolicyRule>> => Boolean(rule))
    cachedPolicy = { grants, pageRules: rules }
    return cachedPolicy
  }

  const toGroupView = (group: Group): AuthzGroupView => ({
    id: group.id,
    key: group.key,
    name: group.name,
    description: group.description,
    createdAt: group.createdAt,
    members: db
      .select({ c: sql<number>`count(*)` })
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, group.id))
      .get()?.c ?? 0,
  })

  return {
    ensureDefaults() {
      if (defaultsReady) return
      const now = Date.now()
      for (const group of DEFAULT_GROUPS) {
        if (!findGroup(group.key)) {
          db.insert(groups).values({ id: crypto.randomUUID(), ...group, createdAt: now }).run()
        }
      }
      for (const [groupKey, actions] of Object.entries(DEFAULT_ACTIONS) as Array<[keyof typeof DEFAULT_ACTIONS, readonly Action[]]>) {
        if (groupKey === 'guests') {
          for (const action of actions) insertDefaultGrant('anonymous', null, action)
        } else {
          for (const action of actions) insertDefaultGrant('group', groupKey, action)
        }
      }
      defaultsReady = true
      cachedPolicy = null
    },

    principalForUser(user) {
      this.ensureDefaults()
      return {
        id: user.id,
        role: user.role,
        groups: groupsForUser(user.id, user.role),
        policy: policy(),
      }
    },

    principalForApiKey(apiKeyId, role) {
      this.ensureDefaults()
      return {
        id: `api-key:${apiKeyId}`,
        role,
        groups: [ROLE_GROUPS[role]],
        policy: policy(),
      }
    },

    canAnonymous(action, path) {
      this.ensureDefaults()
      return can(null, action, { path }, policy())
    },

    syncRoleGroup(userId, role) {
      this.ensureDefaults()
      const roleKeys = new Set(Object.values(ROLE_GROUPS))
      const memberships = db
        .select({ membershipId: groupMemberships.id, groupKey: groups.key })
        .from(groupMemberships)
        .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
        .where(eq(groupMemberships.userId, userId))
        .all()
      for (const membership of memberships) {
        if (roleKeys.has(membership.groupKey) && membership.groupKey !== ROLE_GROUPS[role]) {
          db.delete(groupMemberships).where(eq(groupMemberships.id, membership.membershipId)).run()
        }
      }
      const group = findGroup(ROLE_GROUPS[role])
      if (!group) return
      const existing = db
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, group.id)))
        .get()
      if (!existing) {
        db.insert(groupMemberships)
          .values({ id: crypto.randomUUID(), userId, groupId: group.id, createdAt: Date.now() })
          .run()
      }
    },

    listGroups(principal) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      this.ensureDefaults()
      return ok(db.select().from(groups).orderBy(asc(groups.key)).all().map(toGroupView))
    },

    createGroup(principal, input) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const key = cleanKey(input.key)
      if (!key) return err(validationError('Group key is required', 'key'))
      if (findGroup(key)) return err(conflict('Group already exists'))
      const group: Group = {
        id: crypto.randomUUID(),
        key,
        name: input.name.trim() || key,
        description: input.description?.trim() ?? '',
        createdAt: Date.now(),
      }
      try {
        db.insert(groups).values(group).run()
      } catch (error) {
        if (isUniqueConstraintError(error)) return err(conflict('Group already exists'))
        throw error
      }
      return ok(toGroupView(group))
    },

    addUserToGroup(principal, userId, groupKey) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      this.ensureDefaults()
      const group = findGroup(groupKey)
      if (!group) return err(validationError('Group not found', 'groupKey'))
      const existing = db
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, group.id)))
        .get()
      if (!existing) {
        db.insert(groupMemberships)
          .values({ id: crypto.randomUUID(), userId, groupId: group.id, createdAt: Date.now() })
          .run()
      }
      return ok({ userId, groupKey: group.key })
    },

    removeUserFromGroup(principal, userId, groupKey) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const group = findGroup(groupKey)
      if (!group) return err(validationError('Group not found', 'groupKey'))
      db.delete(groupMemberships)
        .where(and(eq(groupMemberships.userId, userId), eq(groupMemberships.groupId, group.id)))
        .run()
      return ok({ userId, groupKey: group.key })
    },

    listPageRules(principal) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      return ok(db.select().from(pageRules).orderBy(asc(pageRules.createdAt)).all())
    },

    createPageRule(principal, input) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      if (!ACTIONS.has(input.action)) return err(validationError('Unknown action', 'action'))
      if (!EFFECTS.has(input.effect)) return err(validationError('Unknown effect', 'effect'))
      if (!SUBJECT_TYPES.has(input.subjectType)) return err(validationError('Unknown subject type', 'subjectType'))
      if (!MATCHERS.has(input.matcher)) return err(validationError('Unknown matcher', 'matcher'))
      const pattern = input.matcher === 'regex' ? input.pattern.trim() : normalizePath(input.pattern)
      if (!pattern) return err(validationError('Rule pattern is required', 'pattern'))
      const rule: PageRuleRow = {
        id: crypto.randomUUID(),
        subjectType: input.subjectType,
        subjectId: input.subjectType === 'anonymous' ? null : input.subjectId?.trim() || null,
        action: input.action,
        effect: input.effect,
        matcher: input.matcher,
        pattern,
        createdAt: Date.now(),
      }
      db.insert(pageRules).values(rule).run()
      cachedPolicy = null
      return ok(rule)
    },

    deletePageRule(principal, id) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      db.delete(pageRules).where(eq(pageRules.id, id)).run()
      cachedPolicy = null
      return ok({ id })
    },
  }
}
