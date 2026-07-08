import { describe, expect, test } from 'vitest'
import { builtInPageTemplates } from './pageTemplates'

describe('built-in page templates', () => {
  test('meeting template uses the supplied timezone instead of a hardcoded default', () => {
    const meeting = builtInPageTemplates('Europe/Paris').find((template) => template.key === 'builtin:meeting')
    expect(meeting?.content).toContain('timezone: Europe/Paris')
    expect(meeting?.content).not.toContain('timezone: Asia/Tokyo')
  })
})
