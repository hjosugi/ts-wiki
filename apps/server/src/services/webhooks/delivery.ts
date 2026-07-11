import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { asc, desc, eq, inArray, lte } from 'drizzle-orm'
import { err, notFound, ok, requirePermission, validationError } from '@kawaii-wiki/core'
import type { DB } from '../../db/client.ts'
import { webhookDeliveries, webhookSubscriptions, type WebhookDelivery, type WebhookSubscription } from '../../db/schema.ts'
import type {
  WebhookDeliveryView,
  WebhookFetcher,
  WebhookHostnameResolver,
  WebhookPayload,
} from '../webhooks.ts'
import {
  ensurePublicLiteralTarget,
  hostnameForValidation,
  isPrivateOrReservedAddress,
  readLimitedResponseText,
  truncate,
} from './shared.ts'

const MAX_REDIRECTS = 5

export interface WebhookDeliveryPolicy {
  readonly maxAttempts: number
  readonly backoffMs: readonly number[]
  readonly maxResponseBytes: number
  readonly maxErrorBytes: number
}

export const DEFAULT_WEBHOOK_DELIVERY_POLICY: WebhookDeliveryPolicy = {
  maxAttempts: 3,
  backoffMs: [60_000, 120_000, 240_000, 480_000, 900_000],
  maxResponseBytes: 2000,
  maxErrorBytes: 1000,
}

const normalizePolicy = (policy: Partial<WebhookDeliveryPolicy> | undefined): WebhookDeliveryPolicy => ({
  maxAttempts: Math.max(1, Math.trunc(policy?.maxAttempts ?? DEFAULT_WEBHOOK_DELIVERY_POLICY.maxAttempts)),
  backoffMs: policy?.backoffMs?.length ? policy.backoffMs.map((value) => Math.max(1, Math.trunc(value))) : DEFAULT_WEBHOOK_DELIVERY_POLICY.backoffMs,
  maxResponseBytes: Math.max(1, Math.trunc(policy?.maxResponseBytes ?? DEFAULT_WEBHOOK_DELIVERY_POLICY.maxResponseBytes)),
  maxErrorBytes: Math.max(1, Math.trunc(policy?.maxErrorBytes ?? DEFAULT_WEBHOOK_DELIVERY_POLICY.maxErrorBytes)),
})

const errorMessage = (error: unknown, maxErrorBytes: number): string =>
  truncate(error instanceof Error ? error.message : String(error), maxErrorBytes)

const signPayload = (secret: string, timestamp: string, payload: string): string =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`

const retryAt = (now: number, attempts: number, policy: WebhookDeliveryPolicy): number | null => {
  if (attempts >= policy.maxAttempts) return null
  const delay = policy.backoffMs[attempts - 1] ?? policy.backoffMs.at(-1) ?? 60_000
  return now + delay
}

const cloneRequestInit = (init: RequestInit): RequestInit => ({
  ...init,
  headers: new Headers(init.headers),
})

const assertPublicDeliveryTarget = async (
  url: URL,
  resolver: WebhookHostnameResolver,
  allowPrivateTargets: boolean,
): Promise<string | undefined> => {
  if (allowPrivateTargets) return undefined
  const publicLiteral = ensurePublicLiteralTarget(url)
  if (!publicLiteral.ok) throw new Error(publicLiteral.error.message)

  const hostname = hostnameForValidation(url)
  if (isIP(hostname)) return hostname

  const addresses = await resolver(hostname)
  if (addresses.length === 0) {
    throw new Error(`Webhook target hostname ${hostname} did not resolve`)
  }
  const blockedAddress = addresses.find((address) => isPrivateOrReservedAddress(address))
  if (blockedAddress) {
    throw new Error(`Webhook target hostname ${hostname} resolved to blocked address ${blockedAddress}`)
  }
  return addresses[0]
}

const redirectUrl = (url: URL, response: Response): URL | null => {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null
  const location = response.headers.get('location')
  return location ? new URL(location, url) : null
}

const fetchWebhook = async (
  targetUrl: string,
  init: RequestInit,
  fetcher: WebhookFetcher,
  resolver: WebhookHostnameResolver,
  allowPrivateTargets: boolean,
): Promise<Response> => {
  let url = new URL(targetUrl)
  let currentInit = cloneRequestInit(init)

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const address = await assertPublicDeliveryTarget(url, resolver, allowPrivateTargets)
    const response = await fetcher(url.toString(), { ...currentInit, redirect: 'manual' }, { address })
    const next = redirectUrl(url, response)
    if (!next) return response

    if (redirects === MAX_REDIRECTS) {
      throw new Error(`Webhook target exceeded ${MAX_REDIRECTS} redirects`)
    }
    if (next.protocol !== 'https:' && next.protocol !== 'http:') {
      throw new Error('Webhook redirect URL must use http or https')
    }
    if (response.status === 303) {
      currentInit = { ...currentInit, method: 'GET', body: undefined }
    }
    url = next
  }

  throw new Error(`Webhook target exceeded ${MAX_REDIRECTS} redirects`)
}

export interface WebhookDeliveryOptions {
  readonly fetcher: WebhookFetcher
  readonly resolver: WebhookHostnameResolver
  readonly allowPrivateTargets: boolean
  readonly now: () => number
  readonly findSubscription: (id: string) => WebhookSubscription | null
  readonly policy?: Partial<WebhookDeliveryPolicy>
}

export interface WebhookDeliveryService {
  publish(payload: WebhookPayload, subscriptions: WebhookSubscription[]): Promise<WebhookDeliveryView[]>
  listDeliveries: import('../webhooks.ts').WebhookService['listDeliveries']
  retryDelivery: import('../webhooks.ts').WebhookService['retryDelivery']
  processDueDeliveries: import('../webhooks.ts').WebhookService['processDueDeliveries']
}

export const createWebhookDelivery = (
  db: DB,
  {
    fetcher,
    resolver,
    allowPrivateTargets,
    now,
    findSubscription,
    policy: inputPolicy,
  }: WebhookDeliveryOptions,
): WebhookDeliveryService => {
  const policy = normalizePolicy(inputPolicy)
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
      const response = await fetchWebhook(subscription.targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'kawaii-wiki.ts-webhooks/1',
          'x-ts-wiki-delivery': delivery.id,
          'x-ts-wiki-event': delivery.eventType,
          'x-ts-wiki-signature': signature,
          'x-ts-wiki-timestamp': timestamp,
          'x-kawaii-wiki-delivery': delivery.id,
          'x-kawaii-wiki-event': delivery.eventType,
          'x-kawaii-wiki-signature': signature,
          'x-kawaii-wiki-timestamp': timestamp,
        },
        body: delivery.payload,
        signal: AbortSignal.timeout(8_000),
      }, fetcher, resolver, allowPrivateTargets)
      const responseBody = await readLimitedResponseText(response, policy.maxResponseBytes).catch(() => '')
      const updatedAt = now()
      db.update(webhookDeliveries)
        .set({
          status: response.ok ? 'succeeded' : 'failed',
          attempts,
          nextAttemptAt: response.ok ? null : retryAt(updatedAt, attempts, policy),
          responseStatus: response.status,
          responseBody,
          error: response.ok ? null : truncate(response.statusText || `HTTP ${response.status}`, policy.maxErrorBytes),
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
          nextAttemptAt: retryAt(updatedAt, attempts, policy),
          responseStatus: null,
          responseBody: null,
          error: errorMessage(error, policy.maxErrorBytes),
          updatedAt,
          deliveredAt: null,
        })
        .where(eq(webhookDeliveries.id, delivery.id))
        .run()
    }

    const persisted = findDelivery(delivery.id)
    if (!persisted) throw new Error(`Webhook delivery ${delivery.id} disappeared while it was being processed`)
    return toDeliveryView(persisted)
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
    async publish(payload, subscriptions) {
      return subscriptions.map((subscription) => toDeliveryView(enqueue(subscription, payload)))
    },

    listDeliveries(principal, filters = {}) {
      const allowed = requirePermission(principal, 'automation:manage')
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
      const subscriptionIds = [...new Set(rows.map((row) => row.subscriptionId))]
      const names = new Map(
        (subscriptionIds.length
          ? db.select({ id: webhookSubscriptions.id, name: webhookSubscriptions.name })
              .from(webhookSubscriptions)
              .where(inArray(webhookSubscriptions.id, subscriptionIds))
              .all()
          : [])
          .map((subscription) => [subscription.id, subscription.name]),
      )
      return ok(rows.map((row) => ({ ...toDeliveryView(row), subscriptionName: names.get(row.subscriptionId) ?? null })))
    },

    async retryDelivery(principal, id) {
      const allowed = requirePermission(principal, 'automation:manage')
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
      const queued = findDelivery(id)
      if (!queued) return err(notFound('Webhook delivery not found after queueing'))
      return ok(await deliver(queued, subscription))
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
        .filter((delivery) => delivery.status !== 'succeeded' && delivery.attempts < policy.maxAttempts)

      const tasks = rows.flatMap((delivery) => {
        const subscription = findSubscription(delivery.subscriptionId)
        return subscription?.enabled ? [deliver(delivery, subscription)] : []
      })
      return Promise.all(tasks)
    },
  }
}
