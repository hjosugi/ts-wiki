import { describe, test, expect } from 'bun:test'
import { createPresence, dedupeViewers } from './presence.ts'

describe('presence registry', () => {
  test('join, list per path, and leave', () => {
    const p = createPresence()
    p.join('home', 'c1', { userId: 'u1', name: 'Alice', mode: 'viewing' })
    p.join('home', 'c2', { userId: 'u2', name: 'Bob', mode: 'editing' })
    p.join('docs', 'c3', { userId: 'u3', name: 'Cara', mode: 'viewing' })

    expect(p.list('home').map((v) => v.name).sort()).toEqual(['Alice', 'Bob'])
    expect(p.leave('c1')).toBe('home')
    expect(p.list('home').map((v) => v.name)).toEqual(['Bob'])
    expect(p.list('docs')).toHaveLength(1)
    expect(p.leave('unknown')).toBeNull()
  })

  test('dedupe collapses same user, editing wins, anonymous kept distinct', () => {
    const out = dedupeViewers([
      { id: 'c1', userId: 'u1', name: 'Alice', mode: 'viewing' },
      { id: 'c2', userId: 'u1', name: 'Alice', mode: 'editing' }, // same user, editing tab
      { id: 'c3', userId: null, name: 'Anonymous', mode: 'viewing' },
      { id: 'c4', userId: null, name: 'Anonymous', mode: 'viewing' },
    ])
    const alice = out.filter((v) => v.userId === 'u1')
    expect(alice).toHaveLength(1)
    expect(alice[0]?.mode).toBe('editing')
    expect(out.filter((v) => v.userId === null)).toHaveLength(2)
  })
})
