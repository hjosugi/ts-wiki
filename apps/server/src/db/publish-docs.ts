/**
 * Publish this repository's own documentation into open-wiki.
 *
 *   bun --filter '@wiki/server' docs:publish
 *
 * The normal page service is used so render output, TOC, revisions, and FTS are
 * updated exactly as they are for edits made through the UI.
 */
import type { Principal } from '@wiki/core'
import { loadEnv } from '../env.ts'
import { createDb } from './client.ts'
import { createServices } from '../services/index.ts'
import { publishedDocPages } from './published-docs.ts'

const env = loadEnv()
const db = createDb(env.databasePath)
const services = createServices(db)
const principal: Principal = { id: 'docs-publisher', role: 'admin' }

for (const page of publishedDocPages()) {
  const existing = services.pages.getByPath(page.path)

  if (
    existing.ok &&
    existing.value.title === page.title &&
    existing.value.description === page.description &&
    existing.value.content === page.content
  ) {
    console.log(`· skip   ${page.path} (current)`)
    continue
  }

  const result = existing.ok
    ? services.pages.update(page.path, {
        title: page.title,
        description: page.description,
        content: page.content,
      }, principal)
    : services.pages.create(page, principal)

  const action = existing.ok ? 'update' : 'create'
  console.log(result.ok ? `✓ ${action} ${page.path}` : `! ${action} ${page.path}: ${result.error.message}`)
}

db.$client.close()
console.log('✓ docs publish complete')
