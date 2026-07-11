import { eq, lte } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { oauthStates } from '../schema.ts'
import type { OidcStateRepository } from '../../repositories/oidc-states.ts'

export const createSqliteOidcStateRepository = (db: DB): OidcStateRepository => ({
  async cleanupExpired(now) {
    db.delete(oauthStates).where(lte(oauthStates.expiresAt, now)).run()
  },

  async insert(state) {
    db.insert(oauthStates).values(state).run()
  },

  async consume(state, provider, now) {
    return db.transaction((tx) => {
      const stored = tx.select().from(oauthStates).where(eq(oauthStates.state, state)).get()
      if (!stored || stored.provider !== provider) return null
      tx.delete(oauthStates).where(eq(oauthStates.state, state)).run()
      return stored.expiresAt <= now ? null : stored
    })
  },
})
