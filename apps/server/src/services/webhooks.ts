import { createHmac } from 'node:crypto'
import { asc, desc, eq, lte } from 'drizzle-orm'
import {
  type AppError,
  type PageStatus,
  type Principal,
  type Result,
  can,
  err,
  forbidden,
  isPageStatus,
  normalizeLabels,
  normalizePath,
  notFound,
  ok,
  validationError,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import {
  automationRules,
  pages,
  webhookDeliveries,
  webhookSubscriptions,
  type AutomationRule,
  type Page,
  type WebhookDelivery,
  type WebhookSubscription,
} from '../db/schema.ts'

export type WebhookFetcher = (url: string, init: RequestInit) => Promise<Response>

export type WebhookDeliveryStatus = WebhookDelivery['status']
export type AutomationRuleType = AutomationRule['type']

export interface WebhookSubscriptionView {
  readonly id: string
  readonly name: string
  readonly targetUrl: string
  readonly eventTypes: readonly string[]
  readonly enabled: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WebhookDeliveryView {
  readonly id: string
  readonly subscriptionId: string
  readonly subscriptionName: string | null
  readonly eventId: string
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly attempts: number
  readonly nextAttemptAt: number | null
  readonly responseStatus: number | null
  readonly responseBody: string | null
  readonly error: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly deliveredAt: number | null
}

export interface PageUpdatedMetadataRuleConfig {
  readonly pathPrefix: string
  readonly label?: string
  readonly status?: PageStatus
}

export interface AutomationRuleView {
  readonly id: string
  readonly name: string
  readonly type: AutomationRuleType
  readonly enabled: boolean
  readonly config: PageUpdatedMetadataRuleConfig
  readonly createdAt: number
  readonly updatedAt: number
}

export interface CreateWebhookSubscriptionInput {
  readonly name?: string
  readonly targetUrl: string
  readonly secret: string
  readonly eventTypes: readonly string[]
  readonly enabled?: boolean
}

export interface UpdateWebhookSubscriptionInput {
  readonly name?: string
  readonly targetUrl?: string
  readonly secret?: string
  readonly eventTypes?: readonly string[]
  readonly enabled?: boolean
}

export interface CreateAutomationRuleInput {
  readonly name?: string
  readonly type: AutomationRuleType
  readonly enabled?: boolean
  readonly config: PageUpdatedMetadataRuleConfig
}

export interface UpdateAutomationRuleInput {
  readonly name?: string
  readonly enabled?: boolean
  readonly config?: PageUpdatedMetadataRuleConfig
}

export interface AutomationEvent {
  readonly type: string
  readonly actorId?: string | null
  readonly data: Record<string, unknown>
}

export interface WebhookPayload {
  readonly schemaVersion: 1
  readonly id: string
  readonly type: string
  readonly occurredAt: string
  readonly actor: { readonly id: string | null }
  readonly data: Record<string, unknown>
}

export interface WebhookService {
  listSubscriptions(principal: Principal | null): Result<WebhookSubscriptionView[], AppError>
  createSubscription(
    principal: Principal | null,
    input: CreateWebhookSubscriptionInput,
  ): Result<WebhookSubscriptionView, AppError>
  updateSubscription(
    principal: Principal | null,
    id: string,
    input: UpdateWebhookSubscriptionInput,
  ): Result<WebhookSubscriptionView, AppError>
  deleteSubscription(principal: Principal | null, id: string): Result<{ id: string }, AppError>
  listDeliveries(
    principal: Principal | null,
    filters?: { readonly status?: WebhookDeliveryStatus; readonly limit?: number },
  ): Result<WebhookDeliveryView[], AppError>
  retryDelivery(principal: Principal | null, id: string): Promise<Result<WebhookDeliveryView, AppError>>
  listAutomationRules(principal: Principal | null): Result<AutomationRuleView[], AppError>
  createAutomationRule(
    principal: Principal | null,
    input: CreateAutomationRuleInput,
  ): Result<AutomationRuleView, AppError>
  updateAutomationRule(
    principal: Principal | null,
    id: string,
    input: UpdateAutomationRuleInput,
  ): Result<AutomationRuleView, AppError>
  deleteAutomationRule(principal: Principal | null, id: string): Result<{ id: string }, AppError>
  publish(event: AutomationEvent): Promise<WebhookDeliveryView[]>
  processDueDeliveries(limit?: number): Promise<WebhookDeliveryView[]>
}

export interface WebhookServiceOptions {
  readonly fetcher?: WebhookFetcher
  readonly now?: () => number
}

const MAX_RESPONSE_BODY = 2000
const MAX_ERROR = 1000
const MAX_ATTEMPTS = 3

const defaultFetcher: WebhookFetcher = (url, init) => fetch(url, init)

const truncate = (value: string, limit: number): string =>
  value.length > limit ? `${value.slice(0, limit)}...` : value

const errorMessage = (error: unknown): string =>
  truncate(error instanceof Error ? error.message : String(error), MAX_ERROR)

const requireManage = (principal: Principal | null): Result<true, AppError> =>
  can(principal, 'automation:manage') ? ok(true) : err(forbidden())

const cleanName = (name: string | undefined, fallback: string): string => {
  const clean = name?.trim()
  return clean ? clean.slice(0, 120) : fallback
}

const cleanTargetUrl = (value: string): Result<string, AppError> => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return err(validationError('Webhook URL must use http or https', 'targetUrl'))
    }
    return ok(url.toString())
  } catch {
    return err(validationError('Webhook URL is invalid', 'targetUrl'))
  }
}

const cleanSecret = (value: string): Result<string, AppError> => {
  const secret = value.trim()
  return secret ? ok(secret) : err(validationError('Webhook secret is required', 'secret'))
}

const cleanEventTypes = (values: readonly string[]): Result<string[], AppError> => {
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

const parseEventTypes = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const parseLabels = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? normalizeLabels(parsed.filter((item): item is string => typeof item === 'string')) : []
  } catch {
    return []
  }
}

const pageSnapshot = (page: Page) => ({
  id: page.id,
  path: page.path,
  title: page.title,
  lifecycle: page.lifecycle,
  status: page.status,
  labels: parseLabels(page.labels),
  ownerId: page.ownerId,
  reviewAt: page.reviewAt,
  spaceKey: page.spaceKey,
  locale: page.locale,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
})

const cleanRuleConfig = (config: PageUpdatedMetadataRuleConfig): Result<PageUpdatedMetadataRuleConfig, AppError> => {
  const pathPrefix = normalizePath(config.pathPrefix ?? '')
  if (!pathPrefix) return err(validationError('Path prefix is required', 'config.pathPrefix'))

  const label = typeof config.label === 'string' ? normalizeLabels([config.label])[0] : undefined
  const status = config.status
  if (status !== undefined && !isPageStatus(status)) {
    return err(validationError('Unknown page status', 'config.status'))
  }
  if (!label && !status) {
    return err(validationError('Rule must set a label or status', 'config'))
  }

  return ok({
    pathPrefix,
    ...(label ? { label } : {}),
    ...(status ? { status } : {}),
  })
}

const parseRuleConfig = (value: string): PageUpdatedMetadataRuleConfig => {
  try {
    const parsed = JSON.parse(value) as PageUpdatedMetadataRuleConfig
    const clean = cleanRuleConfig(parsed)
    return clean.ok ? clean.value : { pathPrefix: 'invalid', label: 'invalid' }
  } catch {
    return { pathPrefix: 'invalid', label: 'invalid' }
  }
}

const toSubscriptionView = (row: WebhookSubscription): WebhookSubscriptionView => ({
  id: row.id,
  name: row.name,
  targetUrl: row.targetUrl,
  eventTypes: parseEventTypes(row.eventTypes),
  enabled: Boolean(row.enabled),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const toRuleView = (row: AutomationRule): AutomationRuleView => ({
  id: row.id,
  name: row.name,
  type: row.type,
  enabled: Boolean(row.enabled),
  config: parseRuleConfig(row.config),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const eventMatches = (subscription: WebhookSubscription, eventType: string): boolean => {
  const eventTypes = parseEventTypes(subscription.eventTypes)
  return eventTypes.includes('*') || eventTypes.includes(eventType)
}

const signPayload = (secret: string, timestamp: string, payload: string): string =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`

const retryAt = (now: number, attempts: number): number | null =>
  attempts < MAX_ATTEMPTS ? now + Math.min(60_000 * 2 ** (attempts - 1), 15 * 60_000) : null

export const createWebhookService = (db: DB, options: WebhookServiceOptions = {}): WebhookService => {
  const fetcher = options.fetcher ?? defaultFetcher
  const now = options.now ?? (() => Date.now())

  const findSubscription = (id: string): WebhookSubscription | null =>
    db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id)).get() ?? null

  const findDelivery = (id: string): WebhookDelivery | null =>
    db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).get() ?? null

  const toDeliveryView = (row: WebhookDelivery): WebhookDeliveryView => ({
    id: row.id,
    subscriptionId: row.subscriptionId,
    subscriptionName: findSubscription(row.subscriptionId)?.name ?? null,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deliveredAt: row.deliveredAt,
  })

  const deliver = async (delivery: WebhookDelivery, subscription: WebhookSubscription): Promise<WebhookDeliveryView> => {
    const startedAt = now()
    const attempts = delivery.attempts + 1
    const timestamp = String(startedAt)
    const signature = signPayload(subscription.secret, timestamp, delivery.payload)

    try {
      const response = await fetcher(subscription.targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'ts-wiki-webhooks/1',
          'x-ts-wiki-delivery': delivery.id,
          'x-ts-wiki-event': delivery.eventType,
          'x-ts-wiki-signature': signature,
          'x-ts-wiki-timestamp': timestamp,
        },
        body: delivery.payload,
      })
      const responseBody = truncate(await response.text().catch(() => ''), MAX_RESPONSE_BODY)
      const updatedAt = now()
      db.update(webhookDeliveries)
        .set({
          status: response.ok ? 'succeeded' : 'failed',
          attempts,
          nextAttemptAt: response.ok ? null : retryAt(updatedAt, attempts),
          responseStatus: response.status,
          responseBody,
          error: response.ok ? null : truncate(response.statusText || `HTTP ${response.status}`, MAX_ERROR),
          updatedAt,
          deliveredAt: response.ok ? updatedAt : null,
        })
        .where(eq(webhookDeliveries.id, delivery.id))
        .run()
    } catch (error) {
      const updatedAt = now()
      db.update(webhookDeliveries)
        .set({
          status: 'failed',
          attempts,
          nextAttemptAt: retryAt(updatedAt, attempts),
          responseStatus: null,
          responseBody: null,
          error: errorMessage(error),
          updatedAt,
          deliveredAt: null,
        })
        .where(eq(webhookDeliveries.id, delivery.id))
        .run()
    }

    return toDeliveryView(findDelivery(delivery.id)!)
  }

  const findPageForEvent = (event: AutomationEvent): Page | null => {
    const page = event.data.page && typeof event.data.page === 'object'
      ? event.data.page as Record<string, unknown>
      : null
    const id = page?.id
    if (typeof id === 'string') {
      const byId = db.select().from(pages).where(eq(pages.id, id)).get()
      if (byId) return byId
    }
    const path = page?.path
    return typeof path === 'string'
      ? db.select().from(pages).where(eq(pages.path, normalizePath(path))).get() ?? null
      : null
  }

  const applyPageMetadataRules = (event: AutomationEvent): Record<string, unknown> => {
    if (event.type !== 'page.updated') return event.data
    let current = findPageForEvent(event)
    if (!current || current.lifecycle !== 'active') return event.data

    for (const rule of db
      .select()
      .from(automationRules)
      .where(eq(automationRules.enabled, true))
      .orderBy(asc(automationRules.createdAt))
      .all()) {
      if (rule.type !== 'page-updated-metadata') continue
      const config = parseRuleConfig(rule.config)
      if (current.path !== config.pathPrefix && !current.path.startsWith(`${config.pathPrefix.replace(/\/+$/, '')}/`)) {
        continue
      }

      const labels = parseLabels(current.labels)
      const nextLabels = config.label ? normalizeLabels([...labels, config.label]) : labels
      const nextStatus: PageStatus = config.status ?? current.status
      if (JSON.stringify(labels) === JSON.stringify(nextLabels) && current.status === nextStatus) continue

      const updatedAt = now()
      db.update(pages)
        .set({
          labels: JSON.stringify(nextLabels),
          status: nextStatus,
          updatedAt,
        })
        .where(eq(pages.id, current.id))
        .run()
      current = { ...current, labels: JSON.stringify(nextLabels), status: nextStatus, updatedAt }
    }

    return { ...event.data, page: pageSnapshot(current) }
  }

  const enqueue = (subscription: WebhookSubscription, payload: WebhookPayload): WebhookDelivery => {
    const createdAt = now()
    const delivery: WebhookDelivery = {
      id: crypto.randomUUID(),
      subscriptionId: subscription.id,
      eventId: payload.id,
      eventType: payload.type,
      payload: JSON.stringify(payload),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: createdAt,
      responseStatus: null,
      responseBody: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
      deliveredAt: null,
    }
    db.insert(webhookDeliveries).values(delivery).run()
    return delivery
  }

  return {
    listSubscriptions(principal) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      return ok(db.select().from(webhookSubscriptions).orderBy(asc(webhookSubscriptions.createdAt)).all().map(toSubscriptionView))
    },

    createSubscription(principal, input) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      const targetUrl = cleanTargetUrl(input.targetUrl)
      if (!targetUrl.ok) return targetUrl
      const secret = cleanSecret(input.secret)
      if (!secret.ok) return secret
      const eventTypes = cleanEventTypes(input.eventTypes)
      if (!eventTypes.ok) return eventTypes

      const createdAt = now()
      const row: WebhookSubscription = {
        id: crypto.randomUUID(),
        name: cleanName(input.name, new URL(targetUrl.value).hostname),
        targetUrl: targetUrl.value,
        secret: secret.value,
        eventTypes: JSON.stringify(eventTypes.value),
        enabled: input.enabled ?? true,
        createdAt,
        updatedAt: createdAt,
      }
      db.insert(webhookSubscriptions).values(row).run()
      return ok(toSubscriptionView(row))
    },

    updateSubscription(principal, id, input) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      const current = findSubscription(id)
      if (!current) return err(notFound('Webhook subscription not found'))

      const changes: {
        name?: string
        targetUrl?: string
        secret?: string
        eventTypes?: string
        enabled?: boolean
        updatedAt: number
      } = { updatedAt: now() }

      if (input.name !== undefined) changes.name = cleanName(input.name, current.name)
      if (input.targetUrl !== undefined) {
        const targetUrl = cleanTargetUrl(input.targetUrl)
        if (!targetUrl.ok) return targetUrl
        changes.targetUrl = targetUrl.value
      }
      if (input.secret !== undefined) {
        const secret = cleanSecret(input.secret)
        if (!secret.ok) return secret
        changes.secret = secret.value
      }
      if (input.eventTypes !== undefined) {
        const eventTypes = cleanEventTypes(input.eventTypes)
        if (!eventTypes.ok) return eventTypes
        changes.eventTypes = JSON.stringify(eventTypes.value)
      }
      if (input.enabled !== undefined) changes.enabled = input.enabled

      db.update(webhookSubscriptions).set(changes).where(eq(webhookSubscriptions.id, id)).run()
      return ok(toSubscriptionView(findSubscription(id)!))
    },

    deleteSubscription(principal, id) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id)).run()
      return ok({ id })
    },

    listDeliveries(principal, filters = {}) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      const limit = Math.max(1, Math.min(filters.limit ?? 100, 500))
      const rows = filters.status
        ? db
            .select()
            .from(webhookDeliveries)
            .where(eq(webhookDeliveries.status, filters.status))
            .orderBy(desc(webhookDeliveries.createdAt))
            .limit(limit)
            .all()
        : db
            .select()
            .from(webhookDeliveries)
            .orderBy(desc(webhookDeliveries.createdAt))
            .limit(limit)
            .all()
      return ok(rows.map(toDeliveryView))
    },

    async retryDelivery(principal, id) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      const delivery = findDelivery(id)
      if (!delivery) return err(notFound('Webhook delivery not found'))
      const subscription = findSubscription(delivery.subscriptionId)
      if (!subscription) return err(notFound('Webhook subscription not found'))
      if (!subscription.enabled) return err(validationError('Webhook subscription is disabled', 'subscriptionId'))

      const updatedAt = now()
      db.update(webhookDeliveries)
        .set({ status: 'pending', nextAttemptAt: updatedAt, error: null, updatedAt })
        .where(eq(webhookDeliveries.id, id))
        .run()
      return ok(await deliver(findDelivery(id)!, subscription))
    },

    listAutomationRules(principal) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      return ok(db.select().from(automationRules).orderBy(asc(automationRules.createdAt)).all().map(toRuleView))
    },

    createAutomationRule(principal, input) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      if (input.type !== 'page-updated-metadata') return err(validationError('Unknown automation rule type', 'type'))
      const config = cleanRuleConfig(input.config)
      if (!config.ok) return config

      const createdAt = now()
      const rule: AutomationRule = {
        id: crypto.randomUUID(),
        name: cleanName(input.name, 'Page metadata rule'),
        type: input.type,
        enabled: input.enabled ?? true,
        config: JSON.stringify(config.value),
        createdAt,
        updatedAt: createdAt,
      }
      db.insert(automationRules).values(rule).run()
      return ok(toRuleView(rule))
    },

    updateAutomationRule(principal, id, input) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      const current = db.select().from(automationRules).where(eq(automationRules.id, id)).get()
      if (!current) return err(notFound('Automation rule not found'))

      const changes: {
        name?: string
        enabled?: boolean
        config?: string
        updatedAt: number
      } = { updatedAt: now() }

      if (input.name !== undefined) changes.name = cleanName(input.name, current.name)
      if (input.enabled !== undefined) changes.enabled = input.enabled
      if (input.config !== undefined) {
        const config = cleanRuleConfig(input.config)
        if (!config.ok) return config
        changes.config = JSON.stringify(config.value)
      }

      db.update(automationRules).set(changes).where(eq(automationRules.id, id)).run()
      return ok(toRuleView(db.select().from(automationRules).where(eq(automationRules.id, id)).get()!))
    },

    deleteAutomationRule(principal, id) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      db.delete(automationRules).where(eq(automationRules.id, id)).run()
      return ok({ id })
    },

    async publish(event) {
      const data = applyPageMetadataRules(event)
      const payload: WebhookPayload = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        type: event.type,
        occurredAt: new Date(now()).toISOString(),
        actor: { id: event.actorId ?? null },
        data,
      }
      const subscriptions = db
        .select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.enabled, true))
        .orderBy(asc(webhookSubscriptions.createdAt))
        .all()
        .filter((subscription) => eventMatches(subscription, payload.type))

      const deliveries: WebhookDeliveryView[] = []
      for (const subscription of subscriptions) {
        const delivery = enqueue(subscription, payload)
        deliveries.push(await deliver(delivery, subscription))
      }
      return deliveries
    },

    async processDueDeliveries(limit = 25) {
      const dueAt = now()
      const rows = db
        .select()
        .from(webhookDeliveries)
        .where(lte(webhookDeliveries.nextAttemptAt, dueAt))
        .orderBy(asc(webhookDeliveries.nextAttemptAt))
        .limit(Math.max(1, Math.min(limit, 100)))
        .all()
        .filter((delivery) => delivery.status !== 'succeeded' && delivery.attempts < MAX_ATTEMPTS)

      const delivered: WebhookDeliveryView[] = []
      for (const delivery of rows) {
        const subscription = findSubscription(delivery.subscriptionId)
        if (!subscription?.enabled) continue
        delivered.push(await deliver(delivery, subscription))
      }
      return delivered
    },
  }
}
