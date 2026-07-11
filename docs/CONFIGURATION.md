# Configuration reference

The server reads environment variables at startup. Values marked **bootstrap**
seed database-backed settings on first setup and can later be changed in Admin.
Secrets and infrastructure values remain environment-only. `KAWAII_WIKI_*` is
the preferred prefix; legacy `TS_WIKI_*` aliases remain accepted for 1.x.

## Core and database

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP listen port |
| `NODE_ENV` | unset | Use `production` in deployments |
| `JWT_SECRET` | random per process outside production | Required in production; use at least 32 random bytes. The official Docker image generates and persists one in `/data/.jwt-secret` when omitted. |
| `KAWAII_WIKI_JWT_SECRET_FILE` | `/data/.jwt-secret` in Docker | File used by the Docker entrypoint when `JWT_SECRET` is omitted |
| `DATA_DIR` | `./data` | Runtime files and local assets |
| `WEB_DIST_DIR` | `apps/web/dist` | Built SPA directory |
| `DATABASE_DRIVER` | `sqlite` | `sqlite` or `libsql` |
| `DATABASE_PATH` | `DATA_DIR/ts-wiki.sqlite` | SQLite file |
| `LIBSQL_URL` | unset | Local or remote libSQL URL |
| `LIBSQL_AUTH_TOKEN` | unset | Remote libSQL credential |
| `LIBSQL_REPLICA_PATH` | under `DATA_DIR` | Embedded replica file |
| `KAWAII_WIKI_FTS_TOKENIZER` | `unicode61` | `unicode61` or `trigram`; back up before changing an existing index |

## Authentication and policy

| Variable | Default | Purpose |
| --- | --- | --- |
| `KAWAII_WIKI_PUBLIC_ORIGIN` | local server URL | HTTPS public origin for redirects and passkeys |
| `PASSKEY_RP_ID` | public-origin host | WebAuthn relying-party ID |
| `KAWAII_WIKI_SITE_NAME` | `kawaii-wiki.ts` | Auth issuer/display name |
| `KAWAII_WIKI_PRIVATE` | `false` | **Bootstrap:** require login for wiki reads |
| `KAWAII_WIKI_REGISTRATION` | `open` | **Bootstrap:** `open` or `off` |
| `KAWAII_WIKI_REQUIRE_EMAIL_VERIFICATION` | `false` | **Bootstrap:** verify local email before login |
| `KAWAII_WIKI_REQUIRE_2FA` | `false` | **Bootstrap:** require TOTP or passkey |
| `KAWAII_WIKI_JWT_TTL_SECONDS` | `2592000` | **Bootstrap:** session lifetime |
| `KAWAII_WIKI_SEED_ADMIN_PASSWORD` | generated | Optional password used only by `db:seed` |

OIDC supports `OIDC_ENABLED`, `OIDC_PROVIDER_ID`, `OIDC_PROVIDER_LABEL`,
`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`,
`OIDC_SCOPES`, `OIDC_ALLOW_REGISTRATION`, `OIDC_EMAIL_DOMAINS`, and
`OIDC_DEFAULT_ROLE`. Repeat them as `OIDC_1_*`, `OIDC_2_*`, or use the JSON
array `KAWAII_WIKI_OIDC_PROVIDERS`.

## Mail

| Variable | Default | Purpose |
| --- | --- | --- |
| `SMTP_URL` | unset | SMTP connection URL; required to send verification/recovery mail |
| `SMTP_FROM` | site-derived address | RFC 5322 From value |
| `KAWAII_WIKI_SMTP_TIMEOUT_MS` | `10000` | SMTP operation timeout |

## Assets, network, and webhooks

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSET_MAX_BYTES` | `26214400` | **Bootstrap:** upload limit |
| `ASSET_STORAGE` | `local` | `local` or `r2` |
| `ASSET_PUBLIC_BASE_URL` | unset | Optional external asset URL prefix |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | unset | R2 credentials and bucket |
| `R2_ENDPOINT` | Cloudflare endpoint | Optional S3-compatible endpoint |
| `KAWAII_WIKI_CORS_ORIGINS` | same-origin in production | Comma-separated allowed browser origins |
| `KAWAII_WIKI_TRUST_PROXY_HEADERS` | `false` | Trust forwarding headers only behind a trusted proxy |
| `KAWAII_WIKI_WEBHOOK_ALLOW_PRIVATE` | `false` | Allow private/link-local webhook targets; dangerous outside trusted networks |
| `KAWAII_WIKI_WEBHOOK_MAX_ATTEMPTS` | `3` | Delivery attempts |
| `KAWAII_WIKI_WEBHOOK_BACKOFF_MS` | `60000,120000,240000,480000,900000` | Retry delays |
| `KAWAII_WIKI_WEBHOOK_MAX_RESPONSE_BYTES` | `2000` | Stored response prefix |
| `KAWAII_WIKI_WEBHOOK_MAX_ERROR_BYTES` | `1000` | Stored error prefix |

## Appearance, audit, realtime, and Git

Appearance bootstrap variables are `KAWAII_WIKI_SITE_TITLE`,
`KAWAII_WIKI_ACCENT_COLOR`, `KAWAII_WIKI_THEME`,
`KAWAII_WIKI_ALLOW_HEAD_INJECTION`, `KAWAII_WIKI_DEFAULT_LOCALE`,
`KAWAII_WIKI_TIMEZONE`, and `KAWAII_WIKI_DATE_FORMAT`.

Audit retention uses `KAWAII_WIKI_AUDIT_DB`,
`KAWAII_WIKI_AUDIT_RETENTION_DAYS`, and `KAWAII_WIKI_AUDIT_MAX_ROWS`.
Multi-instance realtime uses `KAWAII_WIKI_EVENT_BUS`,
`KAWAII_WIKI_INSTANCE_ID`, and `KAWAII_WIKI_EVENT_POLL_MS`.

Git mirroring uses `KAWAII_WIKI_GIT_ENABLED`, `KAWAII_WIKI_GIT_DIR`,
`KAWAII_WIKI_GIT_BRANCH`, `KAWAII_WIKI_GIT_REMOTE`,
`KAWAII_WIKI_GIT_REMOTE_URL`,
`KAWAII_WIKI_GIT_AUTHOR_NAME`, `KAWAII_WIKI_GIT_AUTHOR_EMAIL`, and
`KAWAII_WIKI_GIT_SYNC_INTERVAL_MS`. Git is a content mirror, not a database
backup.

Example for a public content repository:

```env
KAWAII_WIKI_GIT_ENABLED=true
KAWAII_WIKI_GIT_REMOTE_URL=https://github.com/OWNER/wiki-content.git
KAWAII_WIKI_GIT_BRANCH=main
KAWAII_WIKI_GIT_AUTHOR_NAME=Wiki Editor
KAWAII_WIKI_GIT_AUTHOR_EMAIL=wiki@example.com
KAWAII_WIKI_GIT_SYNC_INTERVAL_MS=300000
```

Never embed a personal access token in `KAWAII_WIKI_GIT_REMOTE_URL`. Configure
an SSH deploy key at the host/container level for private or writable remotes.
The admin Git panel shows status and performs an explicit sync after the service
has been redeployed with these settings.
