import { normalizeLabels, parseJsonStringArray } from '@kawaii-wiki/core'
import type { PageRecord } from '../repositories/pages.ts'

export const parsePageLabels = (value: string): string[] => normalizeLabels(parseJsonStringArray(value))

export const pageSnapshot = (page: PageRecord) => ({
  id: page.id,
  path: page.path,
  title: page.title,
  lifecycle: page.lifecycle,
  status: page.status,
  labels: parsePageLabels(page.labels),
  ownerId: page.ownerId,
  reviewAt: page.reviewAt,
  spaceKey: page.spaceKey,
  locale: page.locale,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
})
