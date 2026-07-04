import { describe, expect, test } from 'bun:test'
import { clientIp, createRateLimiter } from './rate-limit.ts'

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
})
