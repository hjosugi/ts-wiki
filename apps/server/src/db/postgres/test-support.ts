/**
 * Shared setup for the PostgreSQL integration tests.
 *
 * `waitForPostgres` retries the first connection so a server that is reachable
 * but still finishing cold start (the official image briefly accepts then drops
 * connections during init) does not flake the suite, regardless of how the
 * server's readiness was gated.
 */
import { createPostgresClient, type PostgresClient, type PostgresDb } from './client.ts'
import { postgresTableNames, runPostgresMigrations } from './migrate.ts'

export const testPostgresUrl = process.env.KAWAII_WIKI_TEST_POSTGRES_URL?.trim()

export const waitForPostgres = async (client: PostgresClient, attempts = 40): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client.ping()
      return
    } catch (error) {
      if (attempt === attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

export interface PostgresContractDb {
  readonly db: PostgresDb
  readonly client: PostgresClient
  /** Empty every table (and restart identity sequences) for a fresh test. */
  reset(): Promise<void>
  close(): Promise<void>
}

/**
 * A migrated PostgreSQL database isolated in its own schema via the connection
 * `search_path`, so contract-test files running concurrently against the same
 * server never see each other's rows. Each file passes a unique schema name.
 */
export const createPostgresContractDb = async (schemaName: string): Promise<PostgresContractDb> => {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error(`Unsafe test schema name: ${schemaName}`)
  }
  const url = new URL(testPostgresUrl ?? '')
  url.searchParams.set('options', `-c search_path=${schemaName}`)
  const client = createPostgresClient({ driver: 'postgres', url: url.toString(), ssl: false, maxConnections: 4 })
  await waitForPostgres(client)
  await client.sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  await client.sql.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await runPostgresMigrations(client.sql)

  const truncateAll = `TRUNCATE TABLE ${postgresTableNames()
    .map((name) => `"${schemaName}"."${name}"`)
    .join(', ')} RESTART IDENTITY CASCADE`

  return {
    db: client.db,
    client,
    async reset() {
      await client.sql.unsafe(truncateAll)
    },
    async close() {
      await client.sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.close()
    },
  }
}
