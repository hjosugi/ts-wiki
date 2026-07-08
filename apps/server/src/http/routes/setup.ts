import { eq } from 'drizzle-orm'
import { t } from 'elysia'
import { forbidden, type Principal, validationError } from '@ts-wiki/core'
import { users, type User } from '../../db/schema.ts'
import type { DB } from '../../db/client.ts'
import type { Env } from '../../env.ts'
import type { AutomationEvent } from '../../services/webhooks.ts'
import { audit, type StructuredLogger } from '../../observability/logging.ts'
import { HttpError, unwrap } from '../errors.ts'
import { publicUser } from '../representations.ts'
import type { RequestIpServer } from '../rate-limit.ts'
import type { BaseApp } from '../base.ts'

interface JwtSigner {
  sign(payload: Record<string, unknown>): Promise<string>
}

export interface SetupRoutesContext {
  readonly db: DB
  readonly env: Env
  readonly logger: StructuredLogger
  readonly enforceAuthLimit: (
    request: Request,
    server: RequestIpServer | null | undefined,
    scope: string,
  ) => void
  readonly publishAutomation: (event: AutomationEvent) => Promise<void>
}

const adminExists = (db: DB): boolean =>
  Boolean(db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .get())

const signAuthToken = (jwt: JwtSigner, user: Pick<User, 'id' | 'role'>, env: Env): Promise<string> => {
  const now = Date.now()
  return jwt.sign({
    sub: user.id,
    role: user.role,
    iatMs: now,
    exp: Math.floor(now / 1000) + env.auth.tokenTtlSeconds,
  })
}

const homeContent = (siteTitle: string): string => `# Welcome to ${siteTitle}

This is the first page in your wiki. Edit it, link to other pages, or replace it with your team's notes.

- Create a page from the New button.
- Link pages with [[page paths]].
- Use labels and spaces to keep related knowledge together.
`

const samplePages = [
  {
    path: 'help/writing-basics',
    title: 'Writing basics',
    content: `# Writing basics

Use Markdown for headings, lists, tables, code blocks, and links.

## Useful patterns

- Link to another wiki page with [[home]].
- Add labels before publishing so related pages are easy to find.
- Keep one decision, guide, or reference per page.
`,
  },
  {
    path: 'help/organizing-pages',
    title: 'Organizing pages',
    content: `# Organizing pages

Page paths create spaces automatically. A page at \`team/runbook\` appears in the \`team\` space.

## First structure

- \`team/overview\` for ownership and contacts.
- \`runbooks/service-name\` for operational steps.
- \`decisions/YYYY-MM-topic\` for durable decisions.
`,
  },
] as const

export const createSetupRoutes = ({
  db,
  env,
  logger,
  enforceAuthLimit,
  publishAutomation,
}: SetupRoutesContext) => (app: BaseApp) =>
  app
    .get('/api/setup/status', () => ({ needsSetup: !adminExists(db) }))
    .post(
      '/api/setup/complete',
      async ({ body, services, jwt, request, server, set }) => {
        enforceAuthLimit(request, server, 'setup')
        if (adminExists(db)) throw new HttpError(forbidden('Setup is already complete'))

        const siteTitle = body.siteTitle.trim()
        if (!siteTitle) throw new HttpError(validationError('Site title is required', 'siteTitle'))

        const user = unwrap(await services.users.create({
          email: body.email,
          name: body.name,
          password: body.password,
          role: 'admin',
        }))
        services.authz.syncRoleGroup(user.id, user.role)
        const principal: Principal = { id: user.id, role: user.role }

        const settings = unwrap(services.settings.update(principal, {
          siteTitle,
          theme: body.theme,
          homePath: 'home',
          enableEmoji: true,
          enableMermaid: true,
        }))

        const home = unwrap(services.pages.create({
          path: 'home',
          title: `Welcome to ${siteTitle}`,
          content: homeContent(siteTitle),
          labels: ['getting-started'],
          status: 'verified',
          navOrder: 0,
          pinned: true,
        }, principal))

        if (body.sampleContent) {
          for (const page of samplePages) {
            unwrap(services.pages.create({
              ...page,
              labels: ['help'],
              status: 'verified',
            }, principal))
          }
        }

        const searchIndex = unwrap(services.search.rebuildIndex(principal, { tokenizer: body.tokenizer }))
        await publishAutomation({ type: 'user.created', actorId: user.id, data: { user: publicUser(user) } })
        audit(logger, 'setup.complete', {
          userId: user.id,
          tokenizer: searchIndex.tokenizer,
          sampleContent: body.sampleContent,
        })

        set.status = 201
        return {
          token: await signAuthToken(jwt, user, env),
          user: publicUser(user),
          settings,
          home,
          searchIndex,
        }
      },
      {
        body: t.Object({
          email: t.String({ minLength: 3 }),
          name: t.String({ minLength: 1 }),
          password: t.String({ minLength: 6 }),
          siteTitle: t.String({ minLength: 1 }),
          theme: t.Union([t.Literal('system'), t.Literal('light'), t.Literal('dark')]),
          tokenizer: t.Union([t.Literal('unicode61'), t.Literal('trigram')]),
          sampleContent: t.Boolean(),
        }),
      },
    )
