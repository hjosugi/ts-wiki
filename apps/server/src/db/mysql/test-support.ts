/**
 * Shared setup for the MySQL integration tests.
 *
 * `waitForMysql` retries the first connection so a server that is reachable but
 * still finishing cold start does not flake the suite. `createMysqlContractDb`
 * isolates each contract file in its own database — MySQL has no per-schema
 * `search_path`, so file-level isolation is a whole database, which is why the
 * test URL uses root credentials (CREATE/DROP DATABASE).
 */
import { createMysqlClient, type MysqlClient, type MysqlDb } from './client.ts'
import { mysqlTableNames, runMysqlMigrations } from './migrate.ts'

export const testMysqlUrl = process.env.KAWAII_WIKI_TEST_MYSQL_URL?.trim()

export const waitForMysql = async (client: MysqlClient, attempts = 40): Promise<void> => {
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

/** Open a client against the test server's default database, waiting out cold start. */
export const createMysqlTestClient = async (): Promise<MysqlClient> => {
  const client = createMysqlClient({ driver: 'mysql', url: testMysqlUrl ?? '', ssl: false, maxConnections: 4 })
  await waitForMysql(client)
  return client
}

const withDatabase = (url: string, database: string | null): string => {
  const parsed = new URL(url)
  parsed.pathname = database ? `/${database}` : '/'
  return parsed.toString()
}

export interface MysqlContractDb {
  readonly client: MysqlClient
  readonly db: MysqlDb
  /** Empty every table for a fresh test (foreign-key checks are lifted around it). */
  reset(): Promise<void>
  close(): Promise<void>
}

/**
 * A migrated MySQL database isolated per contract file. Each file passes a
 * unique name; the database is dropped and recreated so reruns start clean.
 */
export const createMysqlContractDb = async (databaseName: string): Promise<MysqlContractDb> => {
  if (!/^[a-z_][a-z0-9_]*$/.test(databaseName)) {
    throw new Error(`Unsafe test database name: ${databaseName}`)
  }
  const admin = createMysqlClient({ driver: 'mysql', url: withDatabase(testMysqlUrl ?? '', null), ssl: false, maxConnections: 2 })
  await waitForMysql(admin)
  await admin.pool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``)
  await admin.pool.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`)
  await admin.close()

  const client = createMysqlClient({ driver: 'mysql', url: withDatabase(testMysqlUrl ?? '', databaseName), ssl: false, maxConnections: 4 })
  await runMysqlMigrations(client.pool)

  const truncates = mysqlTableNames().map((name) => `TRUNCATE TABLE \`${name}\``)
  return {
    client,
    db: client.db,
    async reset() {
      await client.pool.query('SET FOREIGN_KEY_CHECKS = 0')
      for (const statement of truncates) await client.pool.query(statement)
      await client.pool.query('SET FOREIGN_KEY_CHECKS = 1')
    },
    async close() {
      await client.pool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``)
      await client.close()
    },
  }
}
