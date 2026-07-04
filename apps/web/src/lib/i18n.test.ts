import { describe, expect, test } from 'vitest'
import { formatDate, setLocale, t } from './i18n'

describe('i18n', () => {
  test('translates the proof locale', () => {
    setLocale('ja')

    expect(t('save')).toBe('保存')
    expect(t('updated', { date: '2026/07/05' })).toBe('更新 2026/07/05')
  })

  test('formats dates with the viewer locale', () => {
    setLocale('en')
    expect(formatDate(Date.UTC(2026, 6, 5))).toContain('2026')

    setLocale('ja')
    expect(formatDate(Date.UTC(2026, 6, 5))).toContain('2026')
  })
})
