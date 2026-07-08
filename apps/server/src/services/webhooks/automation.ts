import { asc, eq } from 'drizzle-orm'
import { err, isPageStatus, normalizeLabels, normalizePath, notFound, ok, type Principal, validationError } from '@ts-wiki/core'
import type { DB } from '../../db/client.ts'
import { automationRules, pages, type AutomationRule, type Page } from '../../db/schema.ts'
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
  requireManage,
} from './shared.ts'

const toRuleView = (row: AutomationRule): AutomationRuleView => ({
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
  applyRules(event: AutomationEvent): AutomationRuleApplication
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

export const createAutomationRules = (db: DB, { now, pageService }: AutomationRuleOptions): AutomationRules => {
  const findPageForEvent = (event: AutomationEvent): Page | null => {
    const page = recordFrom(event.data.page)
    const id = page?.id
    if (typeof id === 'string') {
      const byId = db.select().from(pages).where(eq(pages.id, id)).get()
      if (byId) return byId
    }
    const path = page?.path
    if (typeof path === 'string') {
      const byPath = db.select().from(pages).where(eq(pages.path, normalizePath(path))).get()
      if (byPath) return byPath
    }
    const comment = recordFrom(event.data.comment)
    const commentPath = comment?.path
    return typeof commentPath === 'string'
      ? db.select().from(pages).where(eq(pages.path, normalizePath(commentPath))).get() ?? null
      : null
  }

  const contextFor = (event: AutomationEvent, current: Page | null) => {
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

  const applyPageActions = (current: Page | null, actions: AutomationRuleActions): Page | null => {
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
    current: Page | null,
    config: EventAutomationRuleConfig,
    data: Record<string, unknown>,
    extraEvents: AutomationEvent[],
  ): { page: Page | null; data: Record<string, unknown> } => {
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
    applyRules(event) {
      let current = findPageForEvent(event)
      let data = event.data
      const extraEvents: AutomationEvent[] = []

      for (const rule of db
        .select()
        .from(automationRules)
        .where(eq(automationRules.enabled, true))
        .orderBy(asc(automationRules.priority), asc(automationRules.createdAt))
        .all()) {
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

    list(principal) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      return ok(db.select().from(automationRules).orderBy(asc(automationRules.priority), asc(automationRules.createdAt)).all().map(toRuleView))
    },

    create(principal, input: CreateAutomationRuleInput) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      if (input.type !== 'event-rule' && input.type !== 'page-updated-metadata') return err(validationError('Unknown automation rule type', 'type'))
      const config = cleanRuleConfig(input.config)
      if (!config.ok) return config

      const createdAt = now()
      const rule: AutomationRule = {
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
      db.insert(automationRules).values(rule).run()
      return ok(toRuleView(rule))
    },

    update(principal, id, input: UpdateAutomationRuleInput) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      const current = db.select().from(automationRules).where(eq(automationRules.id, id)).get()
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

      db.update(automationRules).set(changes).where(eq(automationRules.id, id)).run()
      return ok(toRuleView(db.select().from(automationRules).where(eq(automationRules.id, id)).get()!))
    },

    delete(principal, id) {
      const allowed = requireManage(principal)
      if (!allowed.ok) return allowed
      db.delete(automationRules).where(eq(automationRules.id, id)).run()
      return ok({ id })
    },
  }
}
