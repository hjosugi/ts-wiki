import { and, eq } from 'drizzle-orm'
import { toPlainText } from '@kawaii-wiki/core'
import type { PostgresDb } from '../client.ts'
import { assets, pageAssetRefs, pageComments, pages, users } from '../schema.ts'
import type { ElasticsearchSearchDataSource, PageIndexRecord } from '../../../search/elasticsearch/search.ts'
import type { PageIndexSource } from '../../../search/elasticsearch/document.ts'
import { syncPostgresPageAssetReferences } from './asset-references.ts'
import { createPostgresSearchOutboxRepository } from './search-outbox.ts'

/** PostgreSQL source loader used by the Elasticsearch outbox worker. */
export const createPostgresElasticsearchDataSource = (db: PostgresDb): ElasticsearchSearchDataSource => {
  const loadPageSource = async (pageId: string): Promise<PageIndexSource | null> => {
    const [row] = await db
      .select({
        path: pages.path,
        title: pages.title,
        description: pages.description,
        content: pages.content,
        spaceKey: pages.spaceKey,
        status: pages.status,
        locale: pages.locale,
        authorId: pages.authorId,
        authorName: users.name,
        authorEmail: users.email,
        labels: pages.labels,
        icon: pages.icon,
        coverUrl: pages.coverUrl,
        coverPosition: pages.coverPosition,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .leftJoin(users, eq(users.id, pages.authorId))
      .where(and(eq(pages.id, pageId), eq(pages.lifecycle, 'active')))
      .limit(1)
    if (!row) return null

    await syncPostgresPageAssetReferences(db, pageId, row.content)
    const comments = (await db
      .select({ body: pageComments.body })
      .from(pageComments)
      .where(eq(pageComments.pageId, pageId)))
      .map((comment) => toPlainText(comment.body))
      .join('\n')
    const assetText = (await db
      .select({ filename: assets.filename, folder: assets.folder })
      .from(pageAssetRefs)
      .innerJoin(assets, eq(assets.id, pageAssetRefs.assetId))
      .where(eq(pageAssetRefs.pageId, pageId)))
      .map((asset) => `${asset.filename} ${asset.folder}`.trim())
      .join('\n')

    return {
      ...row,
      authorName: row.authorName ?? null,
      authorEmail: row.authorEmail ?? null,
      updatedAt: Number(row.updatedAt),
      comments,
      assets: assetText,
    }
  }

  return {
    outbox: createPostgresSearchOutboxRepository(db),
    loadPageSource,
    async loadAllPageSources(): Promise<PageIndexRecord[]> {
      const records: PageIndexRecord[] = []
      for (const { id } of await db.select({ id: pages.id }).from(pages).where(eq(pages.lifecycle, 'active'))) {
        const source = await loadPageSource(id)
        if (source) records.push({ pageId: id, source })
      }
      return records
    },
  }
}
