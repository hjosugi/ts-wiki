import { afterEach, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssetStorage, type AssetFetch } from './assets.ts'

const roots: string[] = []

const png1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ),
)

const tmpRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'ts-wiki-assets-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('asset storage', () => {
  test('local storage preserves legacy names, URLs, serving, and delete behavior', async () => {
    const dataDir = tmpRoot()
    const storage = createAssetStorage({ type: 'local', dataDir, publicBaseUrl: null })
    const file = new File([png1x1], 'avatar.png', { type: 'image/png' })
    const storageName = storage.storageNameForUpload('asset-id', file)

    expect(storageName).toBe('asset-id-avatar.png')
    expect(storage.url(storageName)).toBe('/assets/asset-id-avatar.png')

    await storage.put({ storageName, file })
    expect(existsSync(join(dataDir, 'assets', storageName))).toBe(true)

    const read = await storage.get(storageName)
    expect(read).not.toBeNull()
    expect(read!.headers.get('content-type')).toBe('image/png')
    expect((await new Response(read!.body).arrayBuffer()).byteLength).toBe(png1x1.byteLength)

    await storage.delete(storageName)
    expect(existsSync(join(dataDir, 'assets', storageName))).toBe(false)
  })

  test('R2 storage uses stable keys, public URLs, and signed S3-compatible requests', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher: AssetFetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      if (init?.method === 'GET') {
        return new Response('asset-bytes', { headers: { 'content-type': 'image/png' } })
      }
      return new Response(null, { status: init?.method === 'DELETE' ? 204 : 200 })
    }
    const storage = createAssetStorage({
      type: 'r2',
      publicBaseUrl: 'https://cdn.example.com/media/',
      r2: {
        accountId: 'account-id',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        bucket: 'wiki-assets',
        endpoint: 'https://account-id.r2.cloudflarestorage.com',
      },
    }, fetcher)
    const file = new File([png1x1], 'Avatar File.png', { type: 'image/png' })
    const storageName = storage.storageNameForUpload('asset-id', file)

    expect(storageName).toBe('assets/asset-id/Avatar_File.png')
    expect(storage.url(storageName)).toBe('https://cdn.example.com/media/assets/asset-id/Avatar_File.png')

    await storage.put({ storageName, file })
    const put = calls[0]!
    const putHeaders = new Headers(put.init.headers)
    expect(put.url).toBe('https://account-id.r2.cloudflarestorage.com/wiki-assets/assets/asset-id/Avatar_File.png')
    expect(put.init.method).toBe('PUT')
    expect(putHeaders.get('content-type')).toBe('image/png')
    expect(putHeaders.get('authorization')).toContain('Credential=access-key/')
    expect(putHeaders.get('authorization')).not.toContain('secret-key')
    expect(putHeaders.get('x-amz-content-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect((await new Response(put.init.body).arrayBuffer()).byteLength).toBe(png1x1.byteLength)

    const read = await storage.get(storageName)
    expect(await new Response(read!.body).text()).toBe('asset-bytes')
    expect(calls[1]!.init.method).toBe('GET')

    await storage.delete(storageName)
    expect(calls[2]!.init.method).toBe('DELETE')
  })
})
