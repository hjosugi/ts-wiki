# HTTP API contract

kawaii-wiki.ts 1.x treats the HTTP routes under `/api` as a public integration
surface. Interactive documentation is served at `/api/docs`; the generated
OpenAPI document is available at `/api/docs/openapi.json`. Runtime schemas in the
Elysia routes and the exported TypeScript contracts in `@kawaii-wiki/server`
remain the source of truth.

GraphQL is not part of the 1.x contract yet; integrations should use the REST
routes so role checks,
page rules, rate limits, and audit behavior remain identical to the web app.

## Stability policy

Within the 1.x release line:

- existing route methods, required request fields, and response fields will not
  be removed or renamed;
- new optional request fields, response fields, routes, and enum values may be
  added in minor releases;
- security fixes may reject input that was always invalid or unsafe;
- a deprecation is documented in the changelog for at least one minor release
  before removal in the next major release.

Clients should ignore unknown response fields and enum values they do not yet
understand. Browser-only setup, OAuth callback, realtime, and static asset
routes may be excluded from the OpenAPI document even though they remain tested.

API keys use `Authorization: Bearer <key>` and are limited by their assigned
role. Session JWTs use the same header but are intended for the bundled web app.
Never put either credential in a URL. Webhook payloads have their own explicit
`version` field and HMAC signature contract.

Breaking changes require a new major application release. Versioned webhook
payloads may introduce a new payload version independently while old supported
versions remain documented in the changelog.
