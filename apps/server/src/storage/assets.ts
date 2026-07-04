import { createHash, createHmac } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { safeAssetFilename, safeAssetStorageName } from '../services/assets.ts'

export type AssetStorageType = 'local' | 'r2'

export interface LocalAssetStorageConfig {
  readonly type: 'local'
  readonly dataDir: string
  readonly publicBaseUrl: string | null
}

export interface R2AssetStorageCredentials {
  readonly accountId: string | null
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucket: string
  readonly endpoint: string
}

export interface R2AssetStorageConfig {
  readonly type: 'r2'
  readonly publicBaseUrl: string | null
  readonly r2: R2AssetStorageCredentials
}

export type AssetStorageConfig = LocalAssetStorageConfig | R2AssetStorageConfig

export interface AssetObject {
  readonly body: BodyInit | null
  readonly headers: Headers
}

export interface AssetStoragePutInput {
  readonly storageName: string
  readonly file: File
}

export interface AssetStorage {
  readonly type: AssetStorageType
  storageNameForUpload(id: string, file: File): string
  url(storageName: string): string
  put(input: AssetStoragePutInput): Promise<void>
  get(storageName: string): Promise<AssetObject | null>
  delete(storageName: string): Promise<void>
}

export type AssetFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>

const encodePathSegment = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )

export const encodeAssetStoragePath = (storageName: string): string =>
  storageName.split('/').map(encodePathSegment).join('/')

const storageUrl = (publicBaseUrl: string | null, storageName: string): string =>
  publicBaseUrl
    ? `${publicBaseUrl.replace(/\/+$/, '')}/${encodeAssetStoragePath(storageName)}`
    : `/assets/${encodeAssetStoragePath(storageName)}`

const isSafeLocalStorageName = (storageName: string): boolean =>
  storageName.length > 0 &&
  storageName === basename(storageName) &&
  storageName !== '.' &&
  storageName !== '..' &&
  !storageName.includes('\\') &&
  !storageName.includes('\0')

const isSafeObjectKey = (storageName: string): boolean => {
  if (!storageName || storageName.startsWith('/') || storageName.includes('\\') || storageName.includes('\0')) {
    return false
  }
  return storageName.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

const objectHeaders = (headers: HeadersInit = {}): Headers => new Headers(headers)

export const createLocalAssetStorage = (config: LocalAssetStorageConfig): AssetStorage => {
  const root = join(config.dataDir, 'assets')
  mkdirSync(root, { recursive: true })

  return {
    type: 'local',
    storageNameForUpload: (id, file) => safeAssetStorageName(file, id),
    url: (storageName) => storageUrl(config.publicBaseUrl, storageName),
    async put({ storageName, file }) {
      if (!isSafeLocalStorageName(storageName)) {
        throw new Error('Refusing to write an unsafe local asset name')
      }
      await Bun.write(join(root, storageName), file)
    },
    async get(storageName) {
      if (!isSafeLocalStorageName(storageName)) return null
      const path = join(root, storageName)
      if (!existsSync(path)) return null
      const file = Bun.file(path)
      return {
        body: file,
        headers: objectHeaders({
          'content-type': file.type || 'application/octet-stream',
        }),
      }
    },
    async delete(storageName) {
      if (!isSafeLocalStorageName(storageName)) return
      rmSync(join(root, storageName), { force: true })
    },
  }
}

const sha256Hex = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

const hmac = (key: string | Uint8Array, value: string): Uint8Array =>
  createHmac('sha256', key).update(value).digest()

const signingKey = (secretAccessKey: string, date: string): Uint8Array => {
  const dateKey = hmac(`AWS4${secretAccessKey}`, date)
  const regionKey = hmac(dateKey, 'auto')
  const serviceKey = hmac(regionKey, 's3')
  return hmac(serviceKey, 'aws4_request')
}

const amzTimestamp = (date = new Date()): { amzDate: string; dateStamp: string } => {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

const objectRequestUrl = (
  endpoint: string,
  bucket: string,
  key: string,
): { url: URL; canonicalUri: string } => {
  const parsed = new URL(endpoint)
  const endpointPath = parsed.pathname.replace(/\/+$/, '')
  const canonicalUri = `${endpointPath}/${[bucket, ...key.split('/')].map(encodePathSegment).join('/')}`
  const url = new URL(parsed.origin)
  url.pathname = canonicalUri
  return { url, canonicalUri }
}

const signedHeadersFor = (headers: Record<string, string>): { canonicalHeaders: string; signedHeaders: string } => {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  return {
    canonicalHeaders: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders: entries.map(([name]) => name).join(';'),
  }
}

const assertR2Response = async (response: Response, method: string, key: string): Promise<void> => {
  if (response.ok) return
  const detail = (await response.text().catch(() => '')).slice(0, 200)
  throw new Error(`R2 ${method} failed for ${key} (${response.status})${detail ? `: ${detail}` : ''}`)
}

export const createR2AssetStorage = (
  config: R2AssetStorageConfig,
  fetcher: AssetFetch = fetch,
): AssetStorage => {
  const request = async (
    method: 'DELETE' | 'GET' | 'PUT',
    key: string,
    options: { body?: Uint8Array; contentType?: string } = {},
  ): Promise<Response> => {
    if (!isSafeObjectKey(key)) {
      throw new Error('Refusing to access an unsafe R2 object key')
    }
    const { url, canonicalUri } = objectRequestUrl(config.r2.endpoint, config.r2.bucket, key)
    const payloadHash = sha256Hex(options.body ?? '')
    const { amzDate, dateStamp } = amzTimestamp()
    const canonicalHeaderValues: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    }
    if (options.contentType) {
      canonicalHeaderValues['content-type'] = options.contentType
    }
    const { canonicalHeaders, signedHeaders } = signedHeadersFor(canonicalHeaderValues)
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`
    const canonicalRequest = [
      method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    const signature = createHmac('sha256', signingKey(config.r2.secretAccessKey, dateStamp))
      .update(stringToSign)
      .digest('hex')
    const headers = new Headers({
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${config.r2.accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    })
    if (options.contentType) {
      headers.set('content-type', options.contentType)
    }
    const body = options.body ? Uint8Array.from(options.body).buffer : undefined
    return fetcher(url, {
      method,
      headers,
      body,
    })
  }

  return {
    type: 'r2',
    storageNameForUpload: (id, file) => `assets/${id}/${safeAssetFilename(file)}`,
    url: (storageName) => storageUrl(config.publicBaseUrl, storageName),
    async put({ storageName, file }) {
      const body = new Uint8Array(await file.arrayBuffer())
      const response = await request('PUT', storageName, { body, contentType: file.type })
      await assertR2Response(response, 'PUT', storageName)
    },
    async get(storageName) {
      const response = await request('GET', storageName)
      if (response.status === 404) return null
      await assertR2Response(response, 'GET', storageName)
      return { body: response.body, headers: response.headers }
    },
    async delete(storageName) {
      const response = await request('DELETE', storageName)
      if (response.status === 404) return
      await assertR2Response(response, 'DELETE', storageName)
    },
  }
}

export const createAssetStorage = (
  config: AssetStorageConfig,
  fetcher?: AssetFetch,
): AssetStorage =>
  config.type === 'local' ? createLocalAssetStorage(config) : createR2AssetStorage(config, fetcher)
