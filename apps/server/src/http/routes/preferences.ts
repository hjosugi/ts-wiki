import { t } from 'elysia'
import { unwrap } from '../errors.ts'
import type { BaseApp } from '../base.ts'

export const createPreferenceRoutes = () => (app: BaseApp) =>
  app
    .get('/api/me/preferences', async ({ services, principal }) => ({
      preferences: unwrap(await services.preferences.get(principal)),
    }))
    .put(
      '/api/me/preferences',
      async ({ body, services, principal }) => ({
        preferences: unwrap(await services.preferences.update(principal, body.preferences)),
      }),
      {
        body: t.Object({
          preferences: t.Any(),
        }),
      },
    )
