/**
 * Authorization — a single pure function and a small role→action matrix.
 *
 * Wiki.js scatters `WIKI.auth.checkAccess(...)` calls across resolvers and
 * models. Here every decision flows through `can()`, so the policy is one
 * readable, testable table.
 */

export type Role = 'admin' | 'editor' | 'viewer'

export type Action =
  | 'page:read'
  | 'page:create'
  | 'page:update'
  | 'page:write'
  | 'page:delete'
  | 'page:move'
  | 'asset:read'
  | 'asset:write'
  | 'asset:delete'
  | 'comment:read'
  | 'comment:write'
  | 'search:read'
  | 'git:sync'
  | 'automation:manage'
  | 'admin:access'

export type PermissionEffect = 'allow' | 'deny'
export type PermissionSubjectType = 'user' | 'group' | 'anonymous'
export type PageRuleMatcher = 'exact' | 'prefix' | 'suffix' | 'regex'

export interface PermissionGrant {
  readonly subjectType: PermissionSubjectType
  readonly subjectId: string | null
  readonly action: Action
  readonly effect: PermissionEffect
}

export interface PageRule {
  readonly subjectType: PermissionSubjectType
  readonly subjectId: string | null
  readonly action: Action
  readonly effect: PermissionEffect
  readonly matcher: PageRuleMatcher
  readonly pattern: string
}

export interface PermissionPolicy {
  readonly grants?: readonly PermissionGrant[]
  readonly pageRules?: readonly PageRule[]
}

export interface PermissionResource {
  readonly path?: string
}

/** `null` principal = anonymous/unauthenticated request. */
export interface Principal {
  readonly id: string
  readonly role: Role
  readonly groups?: readonly string[]
  readonly policy?: PermissionPolicy
}

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  viewer: new Set<Action>(['page:read', 'asset:read', 'comment:read', 'comment:write', 'search:read']),
  editor: new Set<Action>([
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
  ]),
  admin: new Set<Action>([
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
  ]),
}

const equivalentActions = (action: Action): readonly Action[] =>
  action === 'page:write'
    ? ['page:write', 'page:create', 'page:update', 'page:move']
    : action === 'page:create' || action === 'page:update' || action === 'page:move'
      ? [action, 'page:write']
      : [action]

const subjectMatches = (
  principal: Principal | null,
  subjectType: PermissionSubjectType,
  subjectId: string | null,
): boolean => {
  if (principal === null) return subjectType === 'anonymous'
  if (subjectType === 'user') return subjectId === principal.id
  if (subjectType === 'group') return Boolean(subjectId && principal.groups?.includes(subjectId))
  return false
}

const grantDecision = (
  principal: Principal | null,
  action: Action,
  policy: PermissionPolicy | undefined,
): PermissionEffect | null => {
  const actions = equivalentActions(action)
  let allowed = false
  for (const grant of policy?.grants ?? []) {
    if (!actions.includes(grant.action)) continue
    if (!subjectMatches(principal, grant.subjectType, grant.subjectId)) continue
    if (grant.effect === 'deny') return 'deny'
    allowed = true
  }
  return allowed ? 'allow' : null
}

const regexMatches = (pattern: string, path: string): boolean => {
  try {
    return new RegExp(pattern).test(path)
  } catch {
    return false
  }
}

const ruleSpecificity = (rule: PageRule, path: string): number | null => {
  switch (rule.matcher) {
    case 'exact':
      return rule.pattern === path ? 10_000 + rule.pattern.length : null
    case 'prefix':
      return path === rule.pattern || path.startsWith(`${rule.pattern.replace(/\/+$/, '')}/`)
        ? 5_000 + rule.pattern.length
        : null
    case 'suffix':
      return path.endsWith(rule.pattern) ? 2_500 + rule.pattern.length : null
    case 'regex':
      return regexMatches(rule.pattern, path) ? 1_000 + rule.pattern.length : null
  }
}

const pageRuleDecision = (
  principal: Principal | null,
  action: Action,
  path: string | undefined,
  policy: PermissionPolicy | undefined,
): PermissionEffect | null => {
  if (!path) return null
  const actions = equivalentActions(action)
  let specificity = -1
  let effect: PermissionEffect | null = null

  for (const rule of policy?.pageRules ?? []) {
    if (!actions.includes(rule.action)) continue
    if (!subjectMatches(principal, rule.subjectType, rule.subjectId)) continue
    const nextSpecificity = ruleSpecificity(rule, path)
    if (nextSpecificity === null || nextSpecificity < specificity) continue
    if (nextSpecificity > specificity) {
      specificity = nextSpecificity
      effect = rule.effect
      continue
    }
    if (rule.effect === 'deny') effect = 'deny'
  }

  return effect
}

const roleAllows = (principal: Principal | null, action: Action): boolean => {
  if (principal === null) return action === 'page:read' || action === 'asset:read' || action === 'search:read'
  return equivalentActions(action).some((candidate) => MATRIX[principal.role].has(candidate))
}

/** Anonymous users may read; authenticated users also receive optional policy grants/rules. */
export const can = (
  principal: Principal | null,
  action: Action,
  resource: PermissionResource = {},
  policy: PermissionPolicy | undefined = principal?.policy,
): boolean => {
  const rule = pageRuleDecision(principal, action, resource.path, policy)
  if (rule === 'deny') return false
  if (rule === 'allow') return true

  const grant = grantDecision(principal, action, policy)
  if (grant === 'deny') return false
  if (grant === 'allow') return true

  return roleAllows(principal, action)
}
