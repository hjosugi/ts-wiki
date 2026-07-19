/**
 * Shared setup for the MySQL integration tests.
 *
 * `waitForMysql` retries the first connection so a server that is reachable but
 * still finishing cold start (the official image briefly accepts then drops
 * connections during init) does not flake the suite.
 */
import { createMysqlClient, type MysqlClient } from './client.ts'

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

/** Open a client against the test server, waiting out cold start. */
export const createMysqlTestClient = async (): Promise<MysqlClient> => {
  const client = createMysqlClient({ driver: 'mysql', url: testMysqlUrl ?? '', ssl: false, maxConnections: 4 })
  await waitForMysql(client)
  return client
}
