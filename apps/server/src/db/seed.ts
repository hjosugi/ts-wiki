/**
 * Seed script: creates an admin account and a few sample pages so the wiki is
 * not empty on first boot. Idempotent — safe to run repeatedly.
 *
 *   bun run db:seed
 */
import type { Principal } from '@ts-wiki/core'
import { loadEnv } from '../env.ts'
import { createDb } from './client.ts'
import { createServices } from '../services/index.ts'

const ADMIN_EMAIL = 'admin@example.com'
export const SEED_ADMIN_PASSWORD_ENV = 'TS_WIKI_SEED_ADMIN_PASSWORD'

type EnvSource = Record<string, string | undefined>

export interface SeedAdminPassword {
  readonly password: string
  readonly source: 'env' | 'generated'
}

export const generateSeedAdminPassword = (): string => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `ow-${secret}`
}

export const resolveSeedAdminPassword = (
  source: EnvSource = process.env,
  generatePassword: () => string = generateSeedAdminPassword,
): SeedAdminPassword => {
  const configured = source[SEED_ADMIN_PASSWORD_ENV]?.trim()
  if (configured) return { password: configured, source: 'env' }
  return { password: generatePassword(), source: 'generated' }
}

const samplePages = () => [
  {
    path: 'home',
    title: 'Welcome to ts-wiki',
    content: `# Welcome to ts-wiki 👋

A **modern, lean, FP-leaning** wiki. This page is Markdown, rendered on the
server the moment it was saved, and indexed for full-text search.

## What's here

- A pure, isomorphic core (\`@ts-wiki/core\`) — rendering, slugs, permissions.
- A Bun + Elysia API with end-to-end types via Eden Treaty.
- SQLite + FTS5 search with BM25 ranking.

Try the **search** box (top bar) and look for *banana* 🍌, or open the
[Getting Started](/docs/getting-started) guide.
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

> If you ran \`db:seed\`, sign in as \`admin@example.com\` with the password
> printed by the seed command. Without a seeded admin, the first registered
> account becomes the admin.

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
console.log(greet('ts-wiki'))
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
]

export const runSeed = async (): Promise<void> => {
  const env = loadEnv()
  const db = createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer })

  try {
    const services = createServices(db)
    let admin = services.users.findByEmail(ADMIN_EMAIL)
    if (!admin) {
      const seedPassword = resolveSeedAdminPassword()
      const created = await services.users.create({
        email: ADMIN_EMAIL,
        name: 'Admin',
        password: seedPassword.password,
        role: 'admin',
      })
      if (created.ok) {
        admin = created.value
        if (seedPassword.source === 'generated') {
          console.log(`✓ created admin  ${ADMIN_EMAIL}`)
          console.log(`! generated admin password: ${seedPassword.password}`)
          console.log(
            `  Store it now; it will not be shown again. Set ${SEED_ADMIN_PASSWORD_ENV} to choose it explicitly.`,
          )
        } else {
          console.log(`✓ created admin  ${ADMIN_EMAIL} (password from ${SEED_ADMIN_PASSWORD_ENV})`)
        }
      } else {
        console.error('! could not create admin:', created.error.message)
      }
    } else {
      console.log(`· skip   ${ADMIN_EMAIL} (admin exists)`)
    }

    const principal: Principal | null = admin ? { id: admin.id, role: admin.role } : null

    for (const page of samplePages()) {
      if (services.pages.getByPath(page.path).ok) {
        console.log(`· skip   ${page.path} (exists)`)
        continue
      }
      const result = services.pages.create(page, principal)
      console.log(result.ok ? `✓ page   ${page.path}` : `! page   ${page.path}: ${result.error.message}`)
    }

    console.log('✓ seed complete')
  } finally {
    db.$client.close()
  }
}

if (import.meta.main) {
  await runSeed()
}
