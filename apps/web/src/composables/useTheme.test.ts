import { describe, it, expect } from 'vitest'
import { nextMode, resolveDark } from './useTheme'

describe('useTheme', () => {
  it('cycles light -> dark -> system -> light', () => {
    expect(nextMode('light')).toBe('dark')
    expect(nextMode('dark')).toBe('system')
    expect(nextMode('system')).toBe('light')
  })

  it('resolves explicit modes without consulting the OS', () => {
    expect(resolveDark('dark')).toBe(true)
    expect(resolveDark('light')).toBe(false)
  })
})
