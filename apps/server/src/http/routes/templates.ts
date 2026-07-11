import { t } from 'elysia'
import { audit, type StructuredLogger } from '../../observability/logging.ts'
import { unwrap } from '../errors.ts'
import type { BaseApp } from '../base.ts'

export interface TemplateRoutesContext {
  readonly logger: StructuredLogger
}

const templateBody = t.Object({
  name: t.Optional(t.String()),
  description: t.Optional(t.String()),
  icon: t.Optional(t.String()),
  content: t.Optional(t.String()),
  metadata: t.Optional(t.Union([
    t.Object({
      title: t.Optional(t.String()),
      path: t.Optional(t.String()),
      labels: t.Optional(t.Array(t.String())),
      status: t.Optional(t.Union([
        t.Literal('draft'),
        t.Literal('in-review'),
        t.Literal('verified'),
        t.Literal('outdated'),
      ])),
      locale: t.Optional(t.String()),
      reviewAt: t.Optional(t.Union([t.Number(), t.Null()])),
    }),
    t.Null(),
  ])),
})

export const createTemplateRoutes = ({ logger }: TemplateRoutesContext) => (app: BaseApp) =>
  app
    .get('/api/templates', async ({ services, principal }) => ({
      templates: unwrap(await services.templates.list(principal)),
    }))
    .post('/api/templates', async ({ body, services, principal }) => {
      const template = unwrap(await services.templates.create(principal, body))
      audit(logger, 'template.create', {
        userId: principal?.id ?? null,
        templateId: template.id,
        name: template.name,
      })
      return { template }
    }, { body: templateBody })
    .put('/api/templates/:id', async ({ params, body, services, principal }) => {
      const template = unwrap(await services.templates.update(principal, params.id, body))
      audit(logger, 'template.update', {
        userId: principal?.id ?? null,
        templateId: template.id,
        name: template.name,
      })
      return { template }
    }, {
      params: t.Object({ id: t.String() }),
      body: templateBody,
    })
    .delete('/api/templates/:id', async ({ params, services, principal }) => {
      const result = unwrap(await services.templates.remove(principal, params.id))
      audit(logger, 'template.delete', {
        userId: principal?.id ?? null,
        templateId: result.id,
      })
      return result
    }, { params: t.Object({ id: t.String() }) })
