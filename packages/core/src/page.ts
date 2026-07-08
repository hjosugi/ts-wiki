/**
 * Page domain — types and pure validators. No DB, no I/O.
 *
 * The server's `PageService` calls these before touching the database, so all
 * the "is this input sane?" logic is unit-testable in isolation.
 */
import { type Result, ok, err } from './result.ts'
import { type AppError, validationError } from './errors.ts'
import { normalizePath } from './slug.ts'
import { summarize } from './markdown.ts'

export type ContentType = 'markdown'
export type PageStatus = 'draft' | 'in-review' | 'verified' | 'outdated'

export interface PageInput {
  readonly path: string
  readonly title: string
  readonly content: string
  readonly description?: string
  readonly labels?: readonly string[]
  readonly status?: PageStatus
  readonly ownerId?: string | null
  readonly reviewAt?: number | null
  readonly locale?: string | null
  readonly navOrder?: number | null
  readonly pinned?: boolean
}

/** A validated, normalised page input ready to persist. */
export interface ValidPageInput {
  readonly path: string
  readonly title: string
  readonly content: string
  readonly description: string
  readonly contentType: ContentType
  readonly labels: readonly string[]
  readonly status: PageStatus
  readonly ownerId: string | null
  readonly reviewAt: number | null
  readonly locale: string
  readonly navOrder: number | null
  readonly pinned: boolean
}

const MAX_PATH = 512
const MAX_TITLE = 255
const MAX_LABELS = 20
const MAX_LABEL_LENGTH = 40
const MAX_NAV_ORDER = 1_000_000
const PAGE_STATUSES = new Set<PageStatus>(['draft', 'in-review', 'verified', 'outdated'])
const DEFAULT_LOCALE = 'und'

export const normalizeLabel = (label: string): string =>
  normalizePath(label)
    .split('/')
    .filter(Boolean)
    .join('-')

export const normalizeLabels = (labels: readonly string[] = []): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = normalizeLabel(raw)
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label.slice(0, MAX_LABEL_LENGTH))
    if (out.length >= MAX_LABELS) break
  }
  return out
}

export const isPageStatus = (value: unknown): value is PageStatus =>
  typeof value === 'string' && PAGE_STATUSES.has(value as PageStatus)

export const normalizeLocale = (value: string | null | undefined): string => {
  const locale = (value ?? '').trim()
  return /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/.test(locale) ? locale.toLowerCase() : DEFAULT_LOCALE
}

export const validatePageInput = (input: PageInput): Result<ValidPageInput, AppError> => {
  const path = normalizePath(input.path ?? '')
  if (path.length === 0) return err(validationError('Path is required', 'path'))
  if (path.length > MAX_PATH) return err(validationError(`Path must be ≤ ${MAX_PATH} characters`, 'path'))

  const title = (input.title ?? '').trim()
  if (title.length === 0) return err(validationError('Title is required', 'title'))
  if (title.length > MAX_TITLE) return err(validationError(`Title must be ≤ ${MAX_TITLE} characters`, 'title'))

  const content = input.content ?? ''
  const description = (input.description ?? '').trim() || summarize(content)
  const status = input.status ?? 'draft'
  if (!isPageStatus(status)) return err(validationError('Unknown page status', 'status'))
  const ownerId = input.ownerId?.trim() || null
  const reviewAt = typeof input.reviewAt === 'number' && Number.isFinite(input.reviewAt) ? input.reviewAt : null
  const locale = normalizeLocale(input.locale)
  const navOrder = typeof input.navOrder === 'number' && Number.isFinite(input.navOrder)
    ? Math.max(-MAX_NAV_ORDER, Math.min(MAX_NAV_ORDER, Math.trunc(input.navOrder)))
    : null

  return ok({
    path,
    title,
    content,
    description,
    contentType: 'markdown',
    labels: normalizeLabels(input.labels),
    status,
    ownerId,
    reviewAt,
    locale,
    navOrder,
    pinned: input.pinned === true,
  })
}
