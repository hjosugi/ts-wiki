import { eq } from 'drizzle-orm'
import type { PostgresDb } from '../client.ts'
import { linkPreviews } from '../schema.ts'
import type { LinkPreviewRepository } from '../../../repositories/link-previews.ts'

/** PostgreSQL implementation of the driver-neutral link-preview contract. */
export const createPostgresLinkPreviewRepository = (db: PostgresDb): LinkPreviewRepository => ({
  async findByUrl(url) {
    const [row] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, url)).limit(1)
    return row
  },

  async upsert(preview) {
    await db
      .insert(linkPreviews)
      .values(preview)
      .onConflictDoUpdate({
        target: linkPreviews.url,
        set: {
          kind: preview.kind,
          provider: preview.provider,
          title: preview.title,
          description: preview.description,
          image: preview.image,
          author: preview.author,
          siteName: preview.siteName,
          contentType: preview.contentType,
          data: preview.data,
          fetchedAt: preview.fetchedAt,
          expiresAt: preview.expiresAt,
        },
      })
  },
})
