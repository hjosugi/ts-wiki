/**
 * Seed script: creates an admin account and a few sample pages so the wiki is
 * not empty on first boot. Idempotent — safe to run repeatedly.
 *
 *   bun run db:seed
 */
import type { Principal } from '@wiki/core'
import { loadEnv } from '../env.ts'
import { createDb } from './client.ts'
import { createServices } from '../services/index.ts'
import { publishedDocPages } from './published-docs.ts'

const env = loadEnv()
const db = createDb(env.databasePath)
const services = createServices(db)

const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'password'

let admin = services.users.findByEmail(ADMIN_EMAIL)
if (!admin) {
  const created = await services.users.create({
    email: ADMIN_EMAIL,
    name: 'Admin',
    password: ADMIN_PASSWORD,
    role: 'admin',
  })
  if (created.ok) {
    admin = created.value
    console.log(`✓ created admin  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  } else {
    console.error('! could not create admin:', created.error.message)
  }
}

const principal: Principal | null = admin ? { id: admin.id, role: admin.role } : null

const samplePages = [
  {
    path: 'home',
    title: 'Welcome to open-wiki',
    content: `# Welcome to open-wiki 👋

A **modern, lean, FP-leaning** wiki. This page is Markdown, rendered on the
server the moment it was saved, and indexed for full-text search.

## What's here

- A pure, isomorphic core (\`@wiki/core\`) — rendering, slugs, permissions.
- A Bun + Elysia API with end-to-end types via Eden Treaty.
- SQLite + FTS5 search with BM25 ranking.

Try the **search** box (top bar) and look for *banana* 🍌, or open the
[open-wiki Docs](/docs).
`,
  },
  {
    path: 'docs/getting-started',
    title: 'Getting Started',
    content: `# Getting Started

Welcome! This guide walks you through the basics.

## Creating a page

Click **New page**, pick a path like \`docs/my-page\`, write some Markdown,
and hit save. The server renders it to HTML and updates the search index in a
single transaction — so it's readable and findable immediately.

## Permissions

| Role   | Read | Write | Delete | Admin |
|--------|:----:|:-----:|:------:|:-----:|
| viewer |  ✅  |       |        |       |
| editor |  ✅  |  ✅   |   ✅   |       |
| admin  |  ✅  |  ✅   |   ✅   |  ✅   |

> The very first account you register becomes the admin.

The secret fruit for search testing is **banana**.
`,
  },
  {
    path: 'docs/markdown-guide',
    title: 'Markdown Guide',
    content: `# Markdown Guide

A quick tour of supported Markdown.

## Code

\`\`\`ts
const greet = (name: string): string => \`Hello, \${name}!\`
console.log(greet('open-wiki'))
\`\`\`

## Lists & tasks

- [x] Render Markdown on save
- [x] Full-text search
- [ ] Your first page

## Tables

| Feature | Status |
|---------|--------|
| Headings + TOC | ✅ |
| Syntax highlighting | ✅ |
`,
  },
  ...publishedDocPages(),
]

for (const page of samplePages) {
  if (services.pages.getByPath(page.path).ok) {
    console.log(`· skip   ${page.path} (exists)`)
    continue
  }
  const result = services.pages.create(page, principal)
  console.log(result.ok ? `✓ page   ${page.path}` : `! page   ${page.path}: ${result.error.message}`)
}

db.$client.close()
console.log('✓ seed complete')
