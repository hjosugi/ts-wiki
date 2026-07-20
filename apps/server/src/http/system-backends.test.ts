import { describe, expect, test } from 'bun:test'
import { describeSystemBackends, searchEngineForDriver } from './system-backends.ts'

describe('searchEngineForDriver', () => {
  test('maps each driver to its full-text engine', () => {
    expect(searchEngineForDriver('sqlite')).toBe('fts5')
    expect(searchEngineForDriver('libsql')).toBe('fts5')
    expect(searchEngineForDriver('postgres')).toBe('tsvector')
    expect(searchEngineForDriver('mysql')).toBe('fulltext')
  })
})

describe('describeSystemBackends', () => {
  test('reports the active drivers with search health tracking the database', () => {
    expect(describeSystemBackends({ databaseDriver: 'mysql', assetBackend: 'local', databaseHealthy: true })).toEqual({
      database: { driver: 'mysql', healthy: true },
      search: { backend: 'builtin', engine: 'fulltext', healthy: true },
      assets: { backend: 'local', healthy: true },
    })
  })

  test('an unhealthy database marks the built-in search unhealthy too', () => {
    const status = describeSystemBackends({ databaseDriver: 'postgres', assetBackend: 'r2', databaseHealthy: false })
    expect(status.database).toEqual({ driver: 'postgres', healthy: false })
    expect(status.search).toEqual({ backend: 'builtin', engine: 'tsvector', healthy: false })
    expect(status.assets).toEqual({ backend: 'r2', healthy: true })
  })
})
