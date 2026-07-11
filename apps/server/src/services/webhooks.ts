import type { AppError, PageStatus, Principal, Result } from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import type { AutomationRule, WebhookDelivery } from '../db/schema.ts'
import type { WebhookSubscriptionRepository } from '../repositories/webhooks.ts'
import { createAutomationRules } from './webhooks/automation.ts'
import { createWebhookDelivery, type WebhookDeliveryPolicy } from './webhooks/delivery.ts'
import { defaultFetcher, defaultResolver } from './webhooks/shared.ts'
import { createWebhookSubscriptions } from './webhooks/subscriptions.ts'

export interface WebhookFetchTarget {
  /** Validated address that the default transport pins for this request. */
  readonly address?: string
}

export type WebhookFetcher = (url: string, init: RequestInit, target?: WebhookFetchTarget) => Promise<Response>
export type WebhookHostnameResolver = (hostname: string) => Promise<readonly string[]>

export type WebhookDeliveryStatus = WebhookDelivery['status']
export type AutomationRuleType = AutomationRule['type']
export type AutomationTrigger = 'page.created' | 'page.updated' | 'page.deleted' | 'page.moved' | 'comment.created'

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

export interface AutomationRuleConditions {
  readonly pathPrefix?: string
  readonly label?: string
  readonly status?: PageStatus
  readonly authorId?: string
  readonly locale?: string
  readonly spaceKey?: string
}

export interface AutomationRuleActions {
  readonly addLabel?: string
  readonly setStatus?: PageStatus
  readonly setReviewAt?: number | null
  readonly moveToPath?: string
  readonly fireWebhookEvent?: string
}

export interface EventAutomationRuleConfig {
  readonly trigger: AutomationTrigger
  readonly conditions?: AutomationRuleConditions
  readonly actions: AutomationRuleActions
}

export interface LegacyPageUpdatedMetadataRuleConfig {
  readonly pathPrefix: string
  readonly label?: string
  readonly status?: PageStatus
}

export interface AutomationRuleView {
  readonly id: string
  readonly name: string
  readonly type: AutomationRuleType
  readonly enabled: boolean
  readonly priority: number
  readonly stopOnMatch: boolean
  readonly config: EventAutomationRuleConfig
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
  readonly priority?: number
  readonly stopOnMatch?: boolean
  readonly config: EventAutomationRuleConfig | LegacyPageUpdatedMetadataRuleConfig
}

export interface UpdateAutomationRuleInput {
  readonly name?: string
  readonly enabled?: boolean
  readonly priority?: number
  readonly stopOnMatch?: boolean
  readonly config?: EventAutomationRuleConfig | LegacyPageUpdatedMetadataRuleConfig
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
  listSubscriptions(principal: Principal | null): Promise<Result<WebhookSubscriptionView[], AppError>>
  createSubscription(
    principal: Principal | null,
    input: CreateWebhookSubscriptionInput,
  ): Promise<Result<WebhookSubscriptionView, AppError>>
  updateSubscription(
    principal: Principal | null,
    id: string,
    input: UpdateWebhookSubscriptionInput,
  ): Promise<Result<WebhookSubscriptionView, AppError>>
  deleteSubscription(principal: Principal | null, id: string): Promise<Result<{ id: string }, AppError>>
  listDeliveries(
    principal: Principal | null,
    filters?: { readonly status?: WebhookDeliveryStatus; readonly limit?: number },
  ): Promise<Result<WebhookDeliveryView[], AppError>>
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
  readonly resolver?: WebhookHostnameResolver
  readonly allowPrivateTargets?: boolean
  readonly now?: () => number
  readonly policy?: Partial<WebhookDeliveryPolicy>
  readonly pageService?: import('./pages.ts').PageService
}

export const createWebhookService = (
  db: DB,
  subscriptionRepository: WebhookSubscriptionRepository,
  options: WebhookServiceOptions = {},
): WebhookService => {
  const fetcher = options.fetcher ?? defaultFetcher
  const resolver = options.resolver ?? defaultResolver
  const allowPrivateTargets = options.allowPrivateTargets ?? false
  const now = options.now ?? (() => Date.now())

  const subscriptions = createWebhookSubscriptions(subscriptionRepository, { allowPrivateTargets, now })
  const automation = createAutomationRules(db, { now, pageService: options.pageService })
  const delivery = createWebhookDelivery(db, {
    fetcher,
    resolver,
    allowPrivateTargets,
    now,
    findSubscription: subscriptions.findById,
    policy: options.policy,
  })

  return {
    listSubscriptions: subscriptions.list,
    createSubscription: subscriptions.create,
    updateSubscription: subscriptions.update,
    deleteSubscription: subscriptions.delete,
    listDeliveries: delivery.listDeliveries,
    retryDelivery: delivery.retryDelivery,
    listAutomationRules: automation.list,
    createAutomationRule: automation.create,
    updateAutomationRule: automation.update,
    deleteAutomationRule: automation.delete,

    async publish(event) {
      const applied = automation.applyRules(event)
      const payload: WebhookPayload = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        type: event.type,
        occurredAt: new Date(now()).toISOString(),
        actor: { id: event.actorId ?? null },
        data: applied.data,
      }
      const deliveries = await delivery.publish(payload, await subscriptions.enabledForEvent(payload.type))
      for (const extra of applied.extraEvents) {
        const extraPayload: WebhookPayload = {
          schemaVersion: 1,
          id: crypto.randomUUID(),
          type: extra.type,
          occurredAt: new Date(now()).toISOString(),
          actor: { id: extra.actorId ?? null },
          data: extra.data,
        }
        deliveries.push(...await delivery.publish(extraPayload, await subscriptions.enabledForEvent(extraPayload.type)))
      }
      // Delivery happens out of band: page writes wait only for durable enqueue.
      // Kick the worker promptly; the periodic timer remains the retry safety net.
      void delivery.processDueDeliveries().catch(() => undefined)
      return deliveries
    },

    processDueDeliveries: delivery.processDueDeliveries,
  }
}
