import { and, eq } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { userPreferences } from '../schema.ts'
import type { UserPreferenceRepository } from '../../../repositories/user-preferences.ts'

/** PostgreSQL implementation of the driver-neutral preference contract. */
export const createPostgresUserPreferenceRepository = (db: PostgresDb): UserPreferenceRepository => ({
  async listForUser(userId) {
    return db.select().from(userPreferences).where(eq(userPreferences.userId, userId))
  },

  async applyForUser(userId, mutations, updatedAt) {
    await db.transaction(async (tx) => {
      for (const mutation of mutations) {
        if (mutation.value === null) {
          await tx
            .delete(userPreferences)
            .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, mutation.key)))
          continue
        }
        await tx
          .insert(userPreferences)
          .values({ userId, key: mutation.key, value: mutation.value, updatedAt })
          .onConflictDoUpdate({
            target: [userPreferences.userId, userPreferences.key],
            set: { value: mutation.value, updatedAt },
          })
      }
    })
  },
})
