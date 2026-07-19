import type { MysqlDb } from '../client.ts'
import { siteSettings } from '../schema.ts'
import type { SettingsRepository } from '../../../repositories/settings.ts'

/** MySQL implementation of the driver-neutral settings contract. */
export const createMysqlSettingsRepository = (db: MysqlDb): SettingsRepository => ({
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
          .onDuplicateKeyUpdate({ set: { value: record.value, updatedAt: record.updatedAt } })
      }
    })
  },
})
