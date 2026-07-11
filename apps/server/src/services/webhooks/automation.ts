import { err, isPageStatus, normalizeLabels, normalizePath, notFound, ok, requirePermission, type Principal, validationError } from '@kawaii-wiki/core'
import type { PageRecord } from '../../repositories/pages.ts'
import type { AutomationRuleRecord, WebhookAutomationRepository } from '../../repositories/webhooks.ts'
import type { PageService } from '../pages.ts'
import type {
  AutomationEvent,
  AutomationRuleActions,
  AutomationRuleConditions,
  AutomationRuleView,
  CreateAutomationRuleInput,
  EventAutomationRuleConfig,
  UpdateAutomationRuleInput,
} from '../webhooks.ts'
import {
  cleanName,
  cleanRuleConfig,
  pageSnapshot,
  parseLabels,
  parseRuleConfig,
} from './shared.ts'

const toRuleView = (row: AutomationRuleRecord): AutomationRuleView => ({
  id: row.id,
  name: row.name,
  type: row.type,
  enabled: Boolean(row.enabled),
  priority: row.priority,
  stopOnMatch: Boolean(row.stopOnMatch),
  config: parseRuleConfig(row.config),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export interface AutomationRuleApplication {
  readonly data: Record<string, unknown>
  readonly extraEvents: AutomationEvent[]
}

export interface AutomationRules {
  applyRules(event: AutomationEvent): Promise<AutomationRuleApplication>
  list: import('../webhooks.ts').WebhookService['listAutomationRules']
  create: import('../webhooks.ts').WebhookService['createAutomationRule']
  update: import('../webhooks.ts').WebhookService['updateAutomationRule']
  delete: import('../webhooks.ts').WebhookService['deleteAutomationRule']
}

export interface AutomationRuleOptions {
  readonly now: () => number
  readonly pageService?: PageService
}

const automationPrincipal: Principal = { id: 'automation', role: 'admin' }

const recordFrom = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const stringFrom = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null

const cleanPriority = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-1_000_000, Math.min(1_000_000, Math.trunc(value)))
    : 0

const pageLeaf = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? 'page'

export const createAutomationRules = (repository: WebhookAutomationRepository, { now, pageService }: AutomationRuleOptions): AutomationRules => {
  const findPageForEvent = async (event: AutomationEvent): Promise<PageRecord | null> => {
    const page = recordFrom(event.data.page)
    const id = page?.id
    if (typeof id === 'string') {
      const byId = await repository.findPageById(id)
      if (byId) return byId
    }
    const path = page?.path
    if (typeof path === 'string') {
      const byPath = await repository.findPageByPath(normalizePath(path))
      if (byPath) return byPath
    }
    const comment = recordFrom(event.data.comment)
    const commentPath = comment?.path
    return typeof commentPath === 'string'
      ? await repository.findPageByPath(normalizePath(commentPath)) ?? null
      : null
  }

  const contextFor = (event: AutomationEvent, current: PageRecord | null) => {
    const page = recordFrom(event.data.page)
    const comment = recordFrom(event.data.comment)
    const path = current?.path ?? stringFrom(page?.path) ?? stringFrom(comment?.path) ?? stringFrom(event.data.path) ?? ''
    const snapshotLabels = Array.isArray(page?.labels) ? page.labels.filter((item): item is string => typeof item === 'string') : []
    const labels = current ? parseLabels(current.labels) : normalizeLabels(snapshotLabels)
    const status = isPageStatus(current?.status) ? current.status : isPageStatus(page?.status) ? page.status : undefined
    const locale = current?.locale ?? stringFrom(page?.locale) ?? undefined
    const spaceKey = current?.spaceKey ?? stringFrom(page?.spaceKey) ?? path.split('/')[0] ?? undefined
    const authorIds = new Set(
      [
        event.actorId,
        current?.authorId,
        current?.ownerId,
        stringFrom(page?.authorId),
        stringFrom(page?.ownerId),
        stringFrom(comment?.authorId),
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    )
    return { path, labels, status, locale, spaceKey, authorIds }
  }

  const conditionsMatch = (conditions: AutomationRuleConditions, context: ReturnType<typeof contextFor>): boolean => {
    if (conditions.pathPrefix) {
      const prefix = conditions.pathPrefix.replace(/\/+$/, '')
      if (context.path !== prefix && !context.path.startsWith(`${prefix}/`)) return false
    }
    if (conditions.label && !context.labels.includes(conditions.label)) return false
    if (conditions.status && context.status !== conditions.status) return false
    if (conditions.authorId && !context.authorIds.has(conditions.authorId)) return false
    if (conditions.locale && context.locale !== conditions.locale) return false
    if (conditions.spaceKey && context.spaceKey !== conditions.spaceKey) return false
    return true
  }

  const applyPageActions = (current: PageRecord | null, actions: AutomationRuleActions): PageRecord | null => {
    if (!current || current.lifecycle !== 'active' || !pageService) return current
    let next = current
    const labels = parseLabels(next.labels)
    const nextLabels = actions.addLabel ? normalizeLabels([...labels, actions.addLabel]) : labels
    const nextStatus = actions.setStatus ?? next.status
    const nextReviewAt = 'setReviewAt' in actions ? actions.setReviewAt ?? null : next.reviewAt

    if (
      JSON.stringify(labels) !== JSON.stringify(nextLabels) ||
      next.status !== nextStatus ||
      next.reviewAt !== nextReviewAt
    ) {
      const updated = pageService.update(next.path, {
        description: next.description,
        labels: nextLabels,
        status: nextStatus,
        reviewAt: nextReviewAt,
      }, automationPrincipal)
      if (updated.ok) next = updated.value
    }

    if (actions.moveToPath) {
      const targetParent = actions.moveToPath.replace(/\/+$/, '')
      const targetPath = normalizePath(`${targetParent}/${pageLeaf(next.path)}`)
      if (targetPath && targetPath !== next.path) {
        const moved = pageService.move(next.path, targetPath, automationPrincipal)
        if (moved.ok) next = moved.value
      }
    }

    return next
  }

  const applyRule = (
    event: AutomationEvent,
    current: PageRecord | null,
    config: EventAutomationRuleConfig,
    data: Record<string, unknown>,
    extraEvents: AutomationEvent[],
  ): { page: PageRecord | null; data: Record<string, unknown> } => {
    const page = applyPageActions(current, config.actions)
    const nextData = page ? { ...data, page: pageSnapshot(page) } : data
    if (config.actions.fireWebhookEvent) {
      extraEvents.push({
        type: config.actions.fireWebhookEvent,
        actorId: event.actorId ?? null,
        data: nextData,
      })
    }
    return { page, data: nextData }
  }

  return {
    async applyRules(event) {
      let current = await findPageForEvent(event)
      let data = event.data
      const extraEvents: AutomationEvent[] = []

      for (const rule of await repository.listEnabledRules()) {
        if (rule.type !== 'event-rule' && rule.type !== 'page-updated-metadata') continue
        const config = parseRuleConfig(rule.config)
        if (config.trigger !== event.type) continue
        const context = contextFor(event, current)
        if (!conditionsMatch(config.conditions ?? {}, context)) continue
        const applied = applyRule(event, current, config, data, extraEvents)
        current = applied.page
        data = applied.data
        if (rule.stopOnMatch) break
      }

      return { data, extraEvents }
    },

    async list(principal) {
      const allowed = requirePermission(principal, 'automation:manage')
      if (!allowed.ok) return allowed
      return ok((await repository.listRules()).map(toRuleView))
    },

    async create(principal, input: CreateAutomationRuleInput) {
      const allowed = requirePermission(principal, 'automation:manage')
      if (!allowed.ok) return allowed
      if (input.type !== 'event-rule' && input.type !== 'page-updated-metadata') return err(validationError('Unknown automation rule type', 'type'))
      const config = cleanRuleConfig(input.config)
      if (!config.ok) return config

      const createdAt = now()
      const rule: AutomationRuleRecord = {
        id: crypto.randomUUID(),
        name: cleanName(input.name, 'Automation rule'),
        type: 'event-rule',
        enabled: input.enabled ?? true,
        priority: cleanPriority(input.priority),
        stopOnMatch: input.stopOnMatch ?? false,
        config: JSON.stringify(config.value),
        createdAt,
        updatedAt: createdAt,
      }
      await repository.insertRule(rule)
      return ok(toRuleView(rule))
    },

    async update(principal, id, input: UpdateAutomationRuleInput) {
      const allowed = requirePermission(principal, 'automation:manage')
      if (!allowed.ok) return allowed
      const current = await repository.findRule(id)
      if (!current) return err(notFound('Automation rule not found'))

      const changes: {
        name?: string
        enabled?: boolean
        priority?: number
        stopOnMatch?: boolean
        config?: string
        updatedAt: number
      } = { updatedAt: now() }

      if (input.name !== undefined) changes.name = cleanName(input.name, current.name)
      if (input.enabled !== undefined) changes.enabled = input.enabled
      if (input.priority !== undefined) changes.priority = cleanPriority(input.priority)
      if (input.stopOnMatch !== undefined) changes.stopOnMatch = input.stopOnMatch
      if (input.config !== undefined) {
        const config = cleanRuleConfig(input.config)
        if (!config.ok) return config
        changes.config = JSON.stringify(config.value)
      }

      await repository.updateRule(id, changes)
      const updated = await repository.findRule(id)
      return updated ? ok(toRuleView(updated)) : err(notFound('Automation rule not found after update'))
    },

    async delete(principal, id) {
      const allowed = requirePermission(principal, 'automation:manage')
      if (!allowed.ok) return allowed
      await repository.deleteRule(id)
      return ok({ id })
    },
  }
}
