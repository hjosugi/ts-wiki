/**
 * Minimal fetch-based Elasticsearch client.
 *
 * Kept dependency-free (no official client) for a small footprint and precise
 * control over the ACL-safe queries that later slices build; the request surface
 * is just enough for indexing, search, and index administration. Credentials are
 * supplied from the environment and sent as an ApiKey or Basic header — never
 * stored in the wiki.
 */
import { Buffer } from 'node:buffer'

export interface ElasticsearchClientConfig {
  readonly url: string
  readonly apiKey?: string | null
  readonly username?: string | null
  readonly password?: string | null
  /** Bound every request so an unreachable cluster cannot stall a worker forever. */
  readonly requestTimeoutMs?: number
}

/** A non-2xx response from Elasticsearch, carrying the parsed error body. */
export class ElasticsearchError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ElasticsearchError'
  }
}

export interface ElasticsearchClient {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>
  /** Resolves when the cluster answers, rejects if it is unreachable. */
  ping(): Promise<void>
  close(): void
}

const authHeader = (config: ElasticsearchClientConfig): Record<string, string> => {
  if (config.apiKey) return { authorization: `ApiKey ${config.apiKey}` }
  if (config.username) {
    const basic = Buffer.from(`${config.username}:${config.password ?? ''}`).toString('base64')
    return { authorization: `Basic ${basic}` }
  }
  return {}
}

export const createElasticsearchClient = (config: ElasticsearchClientConfig): ElasticsearchClient => {
  const base = config.url.replace(/\/+$/, '')
  const auth = authHeader(config)
  const requestTimeoutMs = Math.max(100, config.requestTimeoutMs ?? 10_000)

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...auth },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    const text = await response.text()
    const parsed = text ? JSON.parse(text) : undefined
    if (!response.ok) {
      throw new ElasticsearchError(response.status, `Elasticsearch ${method} ${path} failed with ${response.status}`, parsed)
    }
    return parsed as T
  }

  return {
    request,
    async ping() {
      await request('GET', '/_cluster/health')
    },
    close() {
      /* fetch keeps no pooled connections to close */
    },
  }
}
