import { and, eq } from 'drizzle-orm'
import type { MysqlDb } from '../client.ts'
import { userPreferences } from '../schema.ts'
import type { UserPreferenceRepository } from '../../../repositories/user-preferences.ts'

/** MySQL implementation of the driver-neutral preference contract. */
export const createMysqlUserPreferenceRepository = (db: MysqlDb): UserPreferenceRepository => ({
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
          .onDuplicateKeyUpdate({ set: { value: mutation.value, updatedAt } })
      }
    })
  },
})
