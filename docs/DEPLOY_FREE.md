# Render Free + Turso + R2 Deployment

This is the zero-cost deployment path for issue #44.

## Current Support

| Surface | Status |
| --- | --- |
| SQLite database | Supported and still the default via `DATABASE_DRIVER=sqlite`. |
| Local assets | Supported and still the default via `ASSET_STORAGE=local`. |
| R2 assets | Supported through the server asset storage adapter. |
| Local libSQL | Supported via `DATABASE_DRIVER=libsql` and a local `file:` or `:memory:` URL. |
| Turso/libSQL | Supported as a libSQL embedded replica: the server opens a local replica file and syncs it with the remote Turso URL. |

## Render Free Shape

Render Free web services do not provide durable local disk. Use Turso for the
database and R2 for uploaded assets:

```env
NODE_ENV=production
JWT_SECRET=replace-with-a-long-random-secret

DATABASE_DRIVER=libsql
LIBSQL_URL=libsql://your-database.turso.io
LIBSQL_AUTH_TOKEN=your-turso-token
# Optional. Defaults to DATA_DIR/ts-wiki-libsql-replica.db.
LIBSQL_REPLICA_PATH=/tmp/ts-wiki-libsql-replica.db

ASSET_STORAGE=r2
ASSET_PUBLIC_BASE_URL=https://cdn.example.com/assets
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=ts-wiki-assets
```

The replica file may be ephemeral on Render Free; the remote Turso database is
the durable side. `db:reset` removes only the local replica file and never
deletes the remote Turso database.

## Local libSQL

Use this to test the libSQL path without Turso credentials:

```env
DATABASE_DRIVER=libsql
LIBSQL_URL=file:./data/ts-wiki-libsql.db
```

The same migrations, FTS5 search, page writes, comments, permissions,
webhooks, and passkey challenge storage run through the libSQL-compatible raw
client.

## R2 Assets

R2 can be used with either SQLite or libSQL:

```env
ASSET_STORAGE=r2
ASSET_PUBLIC_BASE_URL=https://cdn.example.com/assets
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=ts-wiki-assets
```

Use `R2_ENDPOINT` instead of `R2_ACCOUNT_ID` when a custom S3-compatible
endpoint is needed.

## Operational Notes

- Run `bun --filter '@ts-wiki/server' db:migrate` before first boot or let the
  server run migrations on startup.
- Run `bun --filter '@ts-wiki/server' db:seed` once to create the first admin.
- Keep `TS_WIKI_PUBLIC_ORIGIN` set to the HTTPS URL users open; passkeys and
  OIDC redirects depend on it.
- Keep `PASSKEY_RP_ID` unset unless your public origin hostname differs from the
  WebAuthn relying-party ID you want.
- For multi-instance realtime, keep `TS_WIKI_EVENT_BUS=db`; page-change events
  are stored in the shared database.

## Remaining Production Proof

The code path is implemented and covered by local libSQL integration tests.
Before calling a specific hosted deployment production-ready, run a smoke test
with real Turso and R2 credentials:

1. `db:migrate` and `db:seed`.
2. Register/login with local auth, TOTP, and passkey.
3. Create, update, move, search, archive, and restore a page.
4. Upload and delete an asset through R2.
5. Create a webhook and confirm signed delivery.
