import { eq } from 'drizzle-orm'
import { toPlainText } from '@ts-wiki/core'
import { loadEnv } from '../env.ts'
import { pages } from './schema.ts'
import { createDb } from './client.ts'
import { runMigrations } from './migrate.ts'

const env = loadEnv()
const db = createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer })
db.$client.prepare('DROP TABLE IF EXISTS pages_fts').run()
runMigrations(db.$client, { ftsTokenizer: env.search.ftsTokenizer })
const insert = db.$client.prepare(
  'INSERT INTO pages_fts(page_id, title, description, content) VALUES (?, ?, ?, ?)',
)

for (const page of db.select().from(pages).where(eq(pages.lifecycle, 'active')).all()) {
  insert.run(page.id, page.title, page.description, toPlainText(page.content))
}

db.$client.close()
console.log(`✓ Rebuilt pages_fts with tokenizer=${env.search.ftsTokenizer}`)
