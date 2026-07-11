import { and, eq } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { userPreferences } from '../schema.ts'
import type {
  UserPreferenceMutation,
  UserPreferenceRepository,
} from '../../repositories/user-preferences.ts'

/** SQLite/libSQL implementation of the driver-neutral preference contract. */
export const createSqliteUserPreferenceRepository = (db: DB): UserPreferenceRepository => ({
  async listForUser(userId) {
    return db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).all()
  },

  async applyForUser(userId: string, mutations: readonly UserPreferenceMutation[], updatedAt: number) {
    db.transaction((tx) => {
      for (const mutation of mutations) {
        if (mutation.value === null) {
          tx.delete(userPreferences)
            .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, mutation.key)))
            .run()
          continue
        }
        tx.insert(userPreferences)
          .values({ userId, key: mutation.key, value: mutation.value, updatedAt })
          .onConflictDoUpdate({
            target: [userPreferences.userId, userPreferences.key],
            set: { value: mutation.value, updatedAt },
          })
          .run()
      }
    })
  },
})
