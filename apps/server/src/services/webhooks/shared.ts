import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  type AppError,
  type PageStatus,
  type Principal,
  type Result,
  err,
  isPageStatus,
  normalizeLocale,
  normalizeLabels,
  normalizePath,
  ok,
  parseJsonStringArray,
  requirePermission,
  validationError,
} from '@ts-wiki/core'
import type { WebhookSubscription } from '../../db/schema.ts'
import type {
  AutomationRuleActions,
  AutomationRuleConditions,
  AutomationTrigger,
  EventAutomationRuleConfig,
  WebhookFetcher,
  WebhookHostnameResolver,
} from '../webhooks.ts'
export { pageSnapshot } from '../page-view.ts'

export const defaultFetcher: WebhookFetcher = (url, init) => fetch(url, init)
export const defaultResolver: WebhookHostnameResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((address) => address.address)

export const truncate = (value: string, limit: number): string =>
  value.length > limit ? `${value.slice(0, limit)}...` : value

export const requireManage = (principal: Principal | null): Result<true, AppError> =>
  requirePermission(principal, 'automation:manage')

export const cleanName = (name: string | undefined, fallback: string): string => {
  const clean = name?.trim()
  return clean ? clean.slice(0, 120) : fallback
}

const parseIpv4 = (address: string): number[] | null => {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : null
}

const parseIpv6 = (address: string): Uint16Array | null => {
  const zoneIndex = address.indexOf('%')
  const value = zoneIndex >= 0 ? address.slice(0, zoneIndex) : address
  const [head = '', tail = ''] = value.split('::')
  if (value.split('::').length > 2) return null

  const parseParts = (part: string): number[] | null => {
    if (!part) return []
    const pieces = part.split(':')
    const out: number[] = []
    for (const piece of pieces) {
      if (!piece) return null
      if (piece.includes('.')) {
        const ipv4 = parseIpv4(piece)
        if (!ipv4) return null
        out.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null
      out.push(Number.parseInt(piece, 16))
    }
    return out
  }

  const headParts = parseParts(head)
  const tailParts = parseParts(tail)
  if (!headParts || !tailParts) return null

  const missing = 8 - headParts.length - tailParts.length
  if (value.includes('::')) {
    if (missing < 0) return null
  } else if (missing !== 0) {
    return null
  }

  return Uint16Array.from([...headParts, ...Array(Math.max(0, missing)).fill(0), ...tailParts])
}

const isPrivateIpv4 = (address: string): boolean => {
  const octets = parseIpv4(address)
  if (!octets) return true
  const a = octets[0]!
  const b = octets[1]!
  const c = octets[2]!
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

const isPrivateIpv6 = (address: string): boolean => {
  const parts = parseIpv6(address)
  if (!parts) return true
  if (parts.every((part) => part === 0)) return true
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return true

  const first = parts[0]!
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80) return true
  if ((first & 0xff00) === 0xff00) return true

  const isMappedIpv4 =
    parts[0] === 0 &&
    parts[1] === 0 &&
    parts[2] === 0 &&
    parts[3] === 0 &&
    parts[4] === 0 &&
    (parts[5] === 0xffff || parts[5] === 0)
  if (isMappedIpv4) {
    return isPrivateIpv4(`${parts[6]! >> 8}.${parts[6]! & 255}.${parts[7]! >> 8}.${parts[7]! & 255}`)
  }

  return false
}

export const isPrivateOrReservedAddress = (address: string): boolean => {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true
}

const hasBlockedLocalName = (hostname: string): boolean => {
  const lower = hostname.toLowerCase().replace(/\.$/, '')
  return lower === 'localhost' || lower.endsWith('.localhost')
}

export const hostnameForValidation = (url: URL): string => url.hostname.replace(/^\[|\]$/g, '')

export const normalizeWebhookUrl = (value: string): Result<URL, AppError> => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return err(validationError('Webhook URL must use http or https', 'targetUrl'))
    }
    return ok(url)
  } catch {
    return err(validationError('Webhook URL is invalid', 'targetUrl'))
  }
}

export const ensurePublicLiteralTarget = (url: URL): Result<true, AppError> => {
  const hostname = hostnameForValidation(url)
  if (hasBlockedLocalName(hostname)) {
    return err(validationError('Webhook URL cannot target private, loopback, link-local, or reserved hosts', 'targetUrl'))
  }
  if (isIP(hostname) && isPrivateOrReservedAddress(hostname)) {
    return err(validationError('Webhook URL cannot target private, loopback, link-local, or reserved hosts', 'targetUrl'))
  }
  return ok(true)
}

export const cleanTargetUrl = (value: string, allowPrivateTargets: boolean): Result<string, AppError> => {
  const url = normalizeWebhookUrl(value)
  if (!url.ok) return url
  if (!allowPrivateTargets) {
    const publicTarget = ensurePublicLiteralTarget(url.value)
    if (!publicTarget.ok) return publicTarget
  }
  return ok(url.value.toString())
}

export const cleanSecret = (value: string): Result<string, AppError> => {
  const secret = value.trim()
  return secret ? ok(secret) : err(validationError('Webhook secret is required', 'secret'))
}

export const cleanEventTypes = (values: readonly string[]): Result<string[], AppError> => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const eventType = value.trim()
    if (!eventType || seen.has(eventType)) continue
    seen.add(eventType)
    out.push(eventType.slice(0, 160))
  }
  return out.length ? ok(out) : err(validationError('At least one event type is required', 'eventTypes'))
}

export const parseEventTypes = (value: string): string[] => parseJsonStringArray(value)

export const parseLabels = (value: string): string[] => normalizeLabels(parseJsonStringArray(value))

const AUTOMATION_TRIGGERS = new Set<AutomationTrigger>([
  'page.created',
  'page.updated',
  'page.deleted',
  'page.moved',
  'comment.created',
])

const cleanTrigger = (value: unknown): AutomationTrigger | null =>
  typeof value === 'string' && AUTOMATION_TRIGGERS.has(value as AutomationTrigger)
    ? value as AutomationTrigger
    : null

const cleanStatus = (value: unknown, field: string): Result<PageStatus | undefined, AppError> => {
  if (value === undefined || value === null || value === '') return ok(undefined)
  if (!isPageStatus(value)) return err(validationError('Unknown page status', field))
  return ok(value)
}

const cleanConditions = (conditions: Partial<AutomationRuleConditions> = {}): Result<AutomationRuleConditions, AppError> => {
  const pathPrefix = typeof conditions.pathPrefix === 'string' ? normalizePath(conditions.pathPrefix) : undefined
  const label = typeof conditions.label === 'string' ? normalizeLabels([conditions.label])[0] : undefined
  const status = cleanStatus(conditions.status, 'config.conditions.status')
  if (!status.ok) return status
  const authorId = typeof conditions.authorId === 'string' ? conditions.authorId.trim().slice(0, 160) : undefined
  const locale = typeof conditions.locale === 'string' && conditions.locale.trim()
    ? normalizeLocale(conditions.locale)
    : undefined
  const spaceKey = typeof conditions.spaceKey === 'string'
    ? normalizePath(conditions.spaceKey).split('/')[0]
    : undefined

  return ok({
    ...(pathPrefix ? { pathPrefix } : {}),
    ...(label ? { label } : {}),
    ...(status.value ? { status: status.value } : {}),
    ...(authorId ? { authorId } : {}),
    ...(locale ? { locale } : {}),
    ...(spaceKey ? { spaceKey } : {}),
  })
}

const cleanActions = (actions: Partial<AutomationRuleActions> = {}): Result<AutomationRuleActions, AppError> => {
  const addLabel = typeof actions.addLabel === 'string' ? normalizeLabels([actions.addLabel])[0] : undefined
  const setStatus = cleanStatus(actions.setStatus, 'config.actions.setStatus')
  if (!setStatus.ok) return setStatus
  const setReviewAt = actions.setReviewAt === null
    ? null
    : typeof actions.setReviewAt === 'number' && Number.isFinite(actions.setReviewAt)
      ? Math.max(0, Math.trunc(actions.setReviewAt))
      : undefined
  const moveToPath = typeof actions.moveToPath === 'string' ? normalizePath(actions.moveToPath) : undefined
  const fireWebhookEvent = typeof actions.fireWebhookEvent === 'string'
    ? actions.fireWebhookEvent.trim().slice(0, 160)
    : undefined

  const out: AutomationRuleActions = {
    ...(addLabel ? { addLabel } : {}),
    ...(setStatus.value ? { setStatus: setStatus.value } : {}),
    ...(setReviewAt !== undefined ? { setReviewAt } : {}),
    ...(moveToPath ? { moveToPath } : {}),
    ...(fireWebhookEvent ? { fireWebhookEvent } : {}),
  }
  if (!out.addLabel && !out.setStatus && !('setReviewAt' in out) && !out.moveToPath && !out.fireWebhookEvent) {
    return err(validationError('Rule must define at least one action', 'config.actions'))
  }
  return ok(out)
}

const legacyRuleConfig = (config: { readonly pathPrefix?: string; readonly label?: string; readonly status?: PageStatus }): EventAutomationRuleConfig => ({
  trigger: 'page.updated',
  conditions: { pathPrefix: normalizePath(config.pathPrefix ?? '') },
  actions: {
    ...(typeof config.label === 'string' && normalizeLabels([config.label])[0]
      ? { addLabel: normalizeLabels([config.label])[0] }
      : {}),
    ...(config.status ? { setStatus: config.status } : {}),
  },
})

export const cleanRuleConfig = (
  config: EventAutomationRuleConfig | { readonly pathPrefix?: string; readonly label?: string; readonly status?: PageStatus },
): Result<EventAutomationRuleConfig, AppError> => {
  const source = 'trigger' in config || 'conditions' in config || 'actions' in config
    ? config as EventAutomationRuleConfig
    : legacyRuleConfig(config)
  const trigger = cleanTrigger(source.trigger)
  if (!trigger) return err(validationError('Unknown automation trigger', 'config.trigger'))
  const conditions = cleanConditions(source.conditions)
  if (!conditions.ok) return conditions
  const actions = cleanActions(source.actions)
  if (!actions.ok) return actions

  return ok({ trigger, conditions: conditions.value, actions: actions.value })
}

export const parseRuleConfig = (value: string): EventAutomationRuleConfig => {
  try {
    const parsed = JSON.parse(value) as EventAutomationRuleConfig
    const clean = cleanRuleConfig(parsed)
    return clean.ok ? clean.value : {
      trigger: 'page.updated',
      conditions: { pathPrefix: 'invalid' },
      actions: { addLabel: 'invalid' },
    }
  } catch {
    return {
      trigger: 'page.updated',
      conditions: { pathPrefix: 'invalid' },
      actions: { addLabel: 'invalid' },
    }
  }
}

export const eventMatches = (subscription: WebhookSubscription, eventType: string): boolean => {
  const eventTypes = parseEventTypes(subscription.eventTypes)
  return eventTypes.includes('*') || eventTypes.includes(eventType)
}
