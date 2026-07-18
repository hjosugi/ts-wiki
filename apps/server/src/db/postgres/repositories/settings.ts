import type { PostgresDb } from '../client.ts'
import { siteSettings } from '../schema.ts'
import type { SettingsRepository } from '../../../repositories/settings.ts'

/** PostgreSQL implementation of the driver-neutral settings contract. */
export const createPostgresSettingsRepository = (db: PostgresDb): SettingsRepository => ({
  async list() {
    return db.select().from(siteSettings)
  },
  async upsertAll(records) {
    if (!records.length) return
    await db.transaction(async (tx) => {
      for (const record of records) {
        await tx
          .insert(siteSettings)
          .values(record)
          .onConflictDoUpdate({
            target: siteSettings.key,
            set: { value: record.value, updatedAt: record.updatedAt },
          })
      }
    })
  },
})
