import type { Page, PageTemplate, PageTemplateMetadata } from './api'

export interface PageTemplateOption {
  key: string
  label: string
  description: string
  icon: string
  content: string
  metadata: PageTemplateMetadata
  builtIn: boolean
}

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export const builtInPageTemplates = (timeZone = browserTimeZone()): PageTemplateOption[] => [
  {
    key: 'builtin:blank',
    label: 'Blank',
    description: '',
    icon: '',
    content: '# New page\n\nStart writing in **Markdown**...\n',
    metadata: { title: '', path: '' },
    builtIn: true,
  },
  {
    key: 'builtin:decision',
    label: 'Decision',
    description: '',
    icon: '',
    content: '# Decision\n\n## Context\n\n## Options\n\n## Decision\n\n## Consequences\n',
    metadata: { title: 'Decision', path: 'decisions/new-decision' },
    builtIn: true,
  },
  {
    key: 'builtin:how-to',
    label: 'How-to',
    description: '',
    icon: '',
    content: '# How-to\n\n## Goal\n\n## Steps\n\n1. \n\n## Checks\n',
    metadata: { title: 'How-to', path: 'guides/new-guide' },
    builtIn: true,
  },
  {
    key: 'builtin:meeting',
    label: 'Meeting notes',
    description: '',
    icon: '',
    content: `# Meeting notes

\`\`\`event
title: Meeting
start: 2026-07-04 10:00
timezone: ${timeZone}
description:
\`\`\`

## Attendees

## Notes

## Actions
`,
    metadata: { title: 'Meeting notes', path: 'meetings/new-meeting' },
    builtIn: true,
  },
  {
    key: 'builtin:spec',
    label: 'Spec',
    description: '',
    icon: '',
    content: '# Spec\n\n## Problem\n\n## Goals\n\n## Non-goals\n\n## Design\n\n## Rollout\n',
    metadata: { title: 'Spec', path: 'specs/new-spec' },
    builtIn: true,
  },
]

export const pageTemplateToOption = (template: PageTemplate): PageTemplateOption => ({
  key: `custom:${template.id}`,
  label: template.name,
  description: template.description,
  icon: template.icon,
  content: template.content,
  metadata: template.metadata,
  builtIn: false,
})

export const templateMetadataFromPageDraft = (draft: {
  title: string
  path: string
  labels: string[]
  status: Page['status']
  locale: string
  reviewAt: number | null
}): PageTemplateMetadata => ({
  title: draft.title,
  path: draft.path,
  labels: draft.labels,
  status: draft.status,
  locale: draft.locale,
  reviewAt: draft.reviewAt,
})
