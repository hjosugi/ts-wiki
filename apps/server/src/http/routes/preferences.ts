import { t } from 'elysia'
import { unwrap } from '../errors.ts'
import type { BaseApp } from '../base.ts'

export const createPreferenceRoutes = () => (app: BaseApp) =>
  app
    .get('/api/me/preferences', ({ services, principal }) => ({
      preferences: unwrap(services.preferences.get(principal)),
    }))
    .put(
      '/api/me/preferences',
      ({ body, services, principal }) => ({
        preferences: unwrap(services.preferences.update(principal, body.preferences)),
      }),
      {
        body: t.Object({
          preferences: t.Any(),
        }),
      },
    )
