import { eq } from 'drizzle-orm'
import type { Principal } from '@kawaii-wiki/core'
import { loadEnv } from '../env.ts'
import { createDb } from './client.ts'
import { users } from './schema.ts'
import { createServices } from '../services/index.ts'
import { OFFICIAL_DOCS_VERSION, officialDocumentationPages } from '../official-docs.ts'

export const runOfficialDocsInstall = (): void => {
  const env = loadEnv()
  const db = createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer })
  try {
    const admin = db.select().from(users).where(eq(users.role, 'admin')).get()
    if (!admin) throw new Error('Create the first admin account before installing official documentation.')
    const principal: Principal = { id: admin.id, role: admin.role }
    const services = createServices(db, {
      search: env.search,
      branding: env.branding,
      localization: env.localization,
      auth: env.auth,
    })

    for (const source of officialDocumentationPages) {
      const result = services.pages.upsertFromFile(source.path, {
        title: source.title,
        description: source.description,
        content: source.content,
      }, {
        labels: source.labels,
        status: source.status,
        locale: source.locale,
        navOrder: source.navOrder,
        pinned: source.path === 'docs/home',
      }, principal)
      if (!result.ok) throw new Error(`${source.path}: ${result.error.message}`)
      console.log(`${result.value.created ? 'create' : 'update'} ${source.path}`)
    }

    if (process.env.KAWAII_WIKI_DOCS_SET_HOME === 'true') {
      const updated = services.settings.update(principal, {
        siteTitle: process.env.KAWAII_WIKI_DOCS_SITE_TITLE?.trim() || 'kawaii-wiki.ts Docs',
        homePath: 'docs/home',
        defaultLocale: 'ja',
        timezone: 'Asia/Tokyo',
      })
      if (!updated.ok) throw new Error(updated.error.message)
    }
    console.log(`official docs ${OFFICIAL_DOCS_VERSION} installed (${officialDocumentationPages.length} pages)`)
  } finally {
    db.$client.close()
  }
}

if (import.meta.main) runOfficialDocsInstall()
