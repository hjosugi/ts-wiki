import { describe, test, expect } from 'bun:test'
import { createCollabHub, type CollabConn } from './collab.ts'

const noopConn = (): CollabConn => ({ send: () => {} })

describe('collab hub', () => {
  test('seeds a room from the DB content on first open', () => {
    const hub = createCollabHub()
    hub.open('docs/intro', noopConn(), () => '# Seeded\n\nbody')
    expect(hub.text('docs/intro')).toBe('# Seeded\n\nbody')
    expect(hub.roomCount()).toBe(1)
  })

  test('a room is shared across connections and discarded when empty', () => {
    const hub = createCollabHub()
    const a = noopConn()
    const b = noopConn()
    hub.open('r', a, () => 'x')
    hub.open('r', b, () => 'ignored — room already exists')
    expect(hub.roomCount()).toBe(1)
    expect(hub.text('r')).toBe('x') // not re-seeded by the 2nd open

    hub.close('r', a)
    expect(hub.roomCount()).toBe(1) // b is still connected
    hub.close('r', b)
    expect(hub.roomCount()).toBe(0)
    expect(hub.text('r')).toBeNull()
  })
})
