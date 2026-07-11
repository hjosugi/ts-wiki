import {
  type AppError,
  type PageStatus,
  type Principal,
  err,
  isPageStatus,
  normalizeLabels,
  normalizeLocale,
  normalizePath,
  notFound,
  ok,
  requirePermission,
  validationError,
  type Result,
} from '@kawaii-wiki/core'
import type {
  PageTemplateRepository,
  StoredPageTemplate,
} from '../repositories/page-templates.ts'

export interface PageTemplateMetadata {
  readonly title?: string
  readonly path?: string
  readonly labels?: readonly string[]
  readonly status?: PageStatus
  readonly locale?: string
  readonly reviewAt?: number | null
}

export interface PageTemplateInput {
  readonly name?: string
  readonly description?: string
  readonly icon?: string
  readonly content?: string
  readonly metadata?: PageTemplateMetadata | null
}

export interface PageTemplateView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly content: string
  readonly metadata: PageTemplateMetadata
  readonly createdBy: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PageTemplateService {
  list(principal: Principal | null): Promise<Result<PageTemplateView[], AppError>>
  create(principal: Principal | null, input: PageTemplateInput): Promise<Result<PageTemplateView, AppError>>
  update(principal: Principal | null, id: string, input: PageTemplateInput): Promise<Result<PageTemplateView, AppError>>
  remove(principal: Principal | null, id: string): Promise<Result<{ id: string }, AppError>>
}

const cleanText = (value: string | undefined, max: number): string =>
  (value ?? '').trim().slice(0, max)

const parseMetadata = (value: string): PageTemplateMetadata => {
  try {
    const parsed = JSON.parse(value) as unknown
    const cleaned = cleanMetadata(parsed && typeof parsed === 'object' ? parsed as PageTemplateMetadata : {})
    return cleaned.ok ? cleaned.value : {}
  } catch {
    return {}
  }
}

const cleanMetadata = (metadata: PageTemplateMetadata | null | undefined): Result<PageTemplateMetadata, AppError> => {
  const source = metadata ?? {}
  const next: PageTemplateMetadata = {}
  const title = cleanText(source.title, 120)
  const path = cleanText(source.path, 300)
  const locale = normalizeLocale(source.locale)
  const reviewAt = source.reviewAt === null || typeof source.reviewAt === 'number' ? source.reviewAt : undefined

  if (title) Object.assign(next, { title })
  if (path) Object.assign(next, { path: normalizePath(path) })
  if (source.labels) Object.assign(next, { labels: normalizeLabels(source.labels) })
  if (source.status !== undefined) {
    if (!isPageStatus(source.status)) return err(validationError('Unknown template page status', 'metadata.status'))
    Object.assign(next, { status: source.status })
  }
  if (locale) Object.assign(next, { locale })
  if (reviewAt !== undefined) Object.assign(next, { reviewAt })
  return ok(next)
}

const cleanInput = (input: PageTemplateInput, existing?: StoredPageTemplate): Result<{
  name: string
  description: string
  icon: string
  content: string
  metadata: PageTemplateMetadata
}, AppError> => {
  const name = input.name === undefined ? existing?.name ?? '' : cleanText(input.name, 80)
  if (!name) return err(validationError('Template name is required', 'name'))
  const content = input.content === undefined ? existing?.content ?? '' : input.content.slice(0, 200_000)
  const metadata = cleanMetadata(input.metadata === undefined ? parseMetadata(existing?.metadata ?? '{}') : input.metadata)
  if (!metadata.ok) return metadata
  return ok({
    name,
    description: input.description === undefined ? existing?.description ?? '' : cleanText(input.description, 500),
    icon: input.icon === undefined ? existing?.icon ?? '' : cleanText(input.icon, 24),
    content,
    metadata: metadata.value,
  })
}

const toView = (row: StoredPageTemplate): PageTemplateView => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  content: row.content,
  metadata: parseMetadata(row.metadata),
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const createPageTemplateService = (repository: PageTemplateRepository): PageTemplateService => {
  const requireEditor = (principal: Principal | null): Result<true, AppError> =>
    requirePermission(principal, 'page:create')

  return {
    async list(principal) {
      const allowed = requireEditor(principal)
      if (!allowed.ok) return allowed
      return ok((await repository.list()).map(toView))
    },

    async create(principal, input) {
      const allowed = requireEditor(principal)
      if (!allowed.ok) return allowed
      const clean = cleanInput(input)
      if (!clean.ok) return clean
      const now = Date.now()
      const row: StoredPageTemplate = {
        id: crypto.randomUUID(),
        name: clean.value.name,
        description: clean.value.description,
        icon: clean.value.icon,
        content: clean.value.content,
        metadata: JSON.stringify(clean.value.metadata),
        createdBy: principal?.id ?? null,
        createdAt: now,
        updatedAt: now,
      }
      await repository.insert(row)
      return ok(toView(row))
    },

    async update(principal, id, input) {
      const allowed = requireEditor(principal)
      if (!allowed.ok) return allowed
      const existing = await repository.findById(id)
      if (!existing) return err(notFound('Template not found'))
      const clean = cleanInput(input, existing)
      if (!clean.ok) return clean
      const updatedAt = Date.now()
      await repository.update(id, {
        name: clean.value.name,
        description: clean.value.description,
        icon: clean.value.icon,
        content: clean.value.content,
        metadata: JSON.stringify(clean.value.metadata),
        updatedAt,
      })
      return ok(toView({ ...existing, ...clean.value, metadata: JSON.stringify(clean.value.metadata), updatedAt }))
    },

    async remove(principal, id) {
      const allowed = requireEditor(principal)
      if (!allowed.ok) return allowed
      const existing = await repository.findById(id)
      if (!existing) return err(notFound('Template not found'))
      await repository.delete(id)
      return ok({ id })
    },
  }
}
