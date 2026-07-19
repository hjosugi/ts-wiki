import { eq, lte } from 'drizzle-orm'
import type { MysqlDb } from '../client.ts'
import { oauthStates } from '../schema.ts'
import type { OidcStateRepository } from '../../../repositories/oidc-states.ts'

/** MySQL implementation of the driver-neutral OIDC-state contract. */
export const createMysqlOidcStateRepository = (db: MysqlDb): OidcStateRepository => ({
  async cleanupExpired(now) {
    await db.delete(oauthStates).where(lte(oauthStates.expiresAt, now))
  },

  async insert(state) {
    await db.insert(oauthStates).values(state)
  },

  async consume(state, provider, now) {
    return db.transaction(async (tx) => {
      const [stored] = await tx.select().from(oauthStates).where(eq(oauthStates.state, state)).limit(1)
      if (!stored || stored.provider !== provider) return null
      await tx.delete(oauthStates).where(eq(oauthStates.state, state))
      return stored.expiresAt <= now ? null : stored
    })
  },
})
