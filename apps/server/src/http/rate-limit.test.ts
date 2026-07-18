import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb } from '../db/client.ts'
import { clientIp, createDbRateLimiter, createRateLimiter, createRateLimiterFactory } from './rate-limit.ts'

const server = (address: string) => ({
  requestIP: () => ({ address }),
})

describe('rate limiter', () => {
  test('evicts idle buckets after the window', () => {
    let now = 1_000
    const limiter = createRateLimiter(2, 100, 10, () => now)

    expect(limiter.check('login:user@example.com')).toBe(true)
    expect(limiter.size()).toBe(1)

    now += 101
    limiter.sweep()

    expect(limiter.size()).toBe(0)
  })

  test('ignores forwarded IP rotation unless proxy headers are trusted', () => {
    const request = new Request('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '203.0.113.5, 198.51.100.10' },
    })

    expect(clientIp(request, server('127.0.0.1'), false)).toBe('127.0.0.1')
    expect(clientIp(request, server('127.0.0.1'), true)).toBe('198.51.100.10')
  })

  test('shares DB-backed buckets across limiter instances', () => {
    let now = 1_000
    const dir = mkdtempSync(join(tmpdir(), 'ts-wiki-rate-limit-'))
    const path = join(dir, 'rate-limit.sqlite')
    const db1 = createDb(path)
    const db2 = createDb(path)
    try {
      const first = createDbRateLimiter(db1.$client, 2, 100, 10, () => now)
      const second = createDbRateLimiter(db2.$client, 2, 100, 10, () => now)

      expect(first.check('login:local')).toBe(true)
      expect(second.check('login:local')).toBe(true)
      expect(first.check('login:local')).toBe(false)
      expect(first.size()).toBe(1)
      expect(second.size()).toBe(1)

      now += 101
      first.sweep(now)

      expect(second.size()).toBe(0)
      expect(second.check('login:local')).toBe(true)
    } finally {
      db1.$client.close()
      db2.$client.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('createRateLimiterFactory', () => {
  test('builds in-memory limiters when no database is given', () => {
    const factory = createRateLimiterFactory({ windowMs: 60_000 })
    const limiter = factory(2)

    expect(limiter.check('login:local')).toBe(true)
    expect(limiter.check('login:local')).toBe(true)
    expect(limiter.check('login:local')).toBe(false)

    // In-memory: a sibling limiter starts empty (no shared persistence).
    expect(factory(2).check('login:local')).toBe(true)
  })

  test('builds DB-backed limiters that share persisted state when a database is given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-wiki-rate-limit-factory-'))
    const path = join(dir, 'rate-limit.sqlite')
    const db = createDb(path)
    try {
      const factory = createRateLimiterFactory({ windowMs: 60_000, database: db.$client })

      expect(factory(2).check('login:local')).toBe(true)
      expect(factory(2).check('login:local')).toBe(true)
      // DB-backed: a fresh limiter over the same client sees the earlier hits.
      const third = factory(2)
      expect(third.check('login:local')).toBe(false)
      expect(third.size()).toBe(1)
    } finally {
      db.$client.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
