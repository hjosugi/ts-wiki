import { err, notFound, ok, requirePermission } from '@kawaii-wiki/core'
import type { WebhookSubscriptionRecord, WebhookSubscriptionRepository } from '../../repositories/webhooks.ts'
import type {
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
  WebhookSubscriptionView,
} from '../webhooks.ts'
import {
  cleanEventTypes,
  cleanName,
  cleanSecret,
  cleanTargetUrl,
  eventMatches,
  parseEventTypes,
} from './shared.ts'

const toSubscriptionView = (row: WebhookSubscriptionRecord): WebhookSubscriptionView => ({
  id: row.id,
  name: row.name,
  targetUrl: row.targetUrl,
  eventTypes: parseEventTypes(row.eventTypes),
  enabled: Boolean(row.enabled),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export interface WebhookSubscriptions {
  findById(id: string): Promise<WebhookSubscriptionRecord | undefined>
  enabledForEvent(eventType: string): Promise<WebhookSubscriptionRecord[]>
  list: import('../webhooks.ts').WebhookService['listSubscriptions']
  create: import('../webhooks.ts').WebhookService['createSubscription']
  update: import('../webhooks.ts').WebhookService['updateSubscription']
  delete: import('../webhooks.ts').WebhookService['deleteSubscription']
}

export interface WebhookSubscriptionOptions {
  readonly allowPrivateTargets: boolean
  readonly now: () => number
}

export const createWebhookSubscriptions = (
  repository: WebhookSubscriptionRepository,
  { allowPrivateTargets, now }: WebhookSubscriptionOptions,
): WebhookSubscriptions => {
  const findById = (id: string) => repository.findById(id)

  return {
    findById,

    async enabledForEvent(eventType) {
      return (await repository.listEnabled()).filter((subscription) => eventMatches(subscription, eventType))
    },

    async list(principal) {
      const allowed = requirePermission(principal, 'automation:manage')
      if (!allowed.ok) return allowed
      return ok((await repository.list()).map(toSubscriptionView))
    },

    async create(principal, input: CreateWebhookSubscriptionInput) {
      const allowed = requirePermission(principal, 'automation:manage')
      if (!allowed.ok) return allowed
      const targetUrl = cleanTargetUrl(input.targetUrl, allowPrivateTargets)
      if (!targetUrl.ok) return targetUrl
      const secret = cleanSecret(input.secret)
      if (!secret.ok) return secret
      const eventTypes = cleanEventTypes(input.eventTypes)
      if (!eventTypes.ok) return eventTypes

      const createdAt = now()
      const row: WebhookSubscriptionRecord = {
        id: crypto.randomUUID(),
        name: cleanName(input.name, new URL(targetUrl.value).hostname),
        targetUrl: targetUrl.value,
        secret: secret.value,
        eventTypes: JSON.stringify(eventTypes.value),
        enabled: input.enabled ?? true,
        createdAt,
        updatedAt: createdAt,
      }
      await repository.insert(row)
      return ok(toSubscriptionView(row))
    },

    async update(principal, id, input: UpdateWebhookSubscriptionInput) {
      const allowed = requirePermission(principal, 'automation:manage')
      if (!allowed.ok) return allowed
      const current = await findById(id)
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
        const targetUrl = cleanTargetUrl(input.targetUrl, allowPrivateTargets)
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

      await repository.update(id, changes)
      const updated = await findById(id)
      return updated ? ok(toSubscriptionView(updated)) : err(notFound('Webhook subscription not found after update'))
    },

    async delete(principal, id) {
      const allowed = requirePermission(principal, 'automation:manage')
      if (!allowed.ok) return allowed
      await repository.delete(id)
      return ok({ id })
    },
  }
}
