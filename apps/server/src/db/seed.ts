/**
 * Seed script: creates an admin account and a few sample pages so the wiki is
 * not empty on first boot. Idempotent — safe to run repeatedly.
 *
 *   bun run db:seed
 */
import type { Principal } from '@kawaii-wiki/core'
import { loadEnv } from '../env.ts'
import { createDb } from './client.ts'
import { createServices } from './services.ts'
import { sampleSeedPages } from '../sample-content.ts'

const ADMIN_EMAIL = 'admin@example.com'
export const SEED_ADMIN_PASSWORD_ENV = 'KAWAII_WIKI_SEED_ADMIN_PASSWORD'
export const LEGACY_SEED_ADMIN_PASSWORD_ENV = 'TS_WIKI_SEED_ADMIN_PASSWORD'

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
  const configured = source[SEED_ADMIN_PASSWORD_ENV]?.trim() ?? source[LEGACY_SEED_ADMIN_PASSWORD_ENV]?.trim()
  if (configured) return { password: configured, source: 'env' }
  return { password: generatePassword(), source: 'generated' }
}

export const runSeed = async (): Promise<void> => {
  const env = loadEnv()
  const db = createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer })

  try {
    const services = createServices(db)
    let admin = await services.users.findByEmail(ADMIN_EMAIL)
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

    for (const page of sampleSeedPages()) {
      if ((await services.pages.getByPath(page.path)).ok) {
        console.log(`· skip   ${page.path} (exists)`)
        continue
      }
      const result = await services.pages.create(page, principal)
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
