/**
 * Schema DDL — including the FTS5 full-text index that Drizzle can't express.
 *
 * The pattern, learned from Wiki.js's PostgreSQL `tsvector` setup: weight the
 * title above the description above the body, and keep the search index in sync
 * with the source rows. Here we do that with a standalone FTS5 table that the
 * PageService updates inside the same transaction as the page write — explicit
 * effects, no hidden triggers.
 */
interface MigratableStatement {
  all(...params: unknown[]): unknown[]
}

interface MigratableDatabase {
  prepare(sql: string): MigratableStatement
  exec(sql: string): unknown
  close?(): unknown
}

export type FtsTokenizer = 'unicode61' | 'trigram'

/** FTS5 tokenizer names exposed through TS_WIKI_FTS_TOKENIZER. */
export const DEFAULT_FTS_TOKENIZER: FtsTokenizer = 'unicode61'
export const FTS_TOKENIZER_SQL: Record<FtsTokenizer, string> = {
  unicode61: 'unicode61 remove_diacritics 2',
  trigram: 'trigram',
}
/** Back-compat constant for older docs/tests. */
export const FTS_TOKENIZER = FTS_TOKENIZER_SQL[DEFAULT_FTS_TOKENIZER]

export interface MigrationOptions {
  readonly ftsTokenizer?: FtsTokenizer
}

const hasColumn = (sqlite: MigratableDatabase, table: string, column: string): boolean =>
  sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => (row as { name?: string }).name === column)

const addColumn = (sqlite: MigratableDatabase, table: string, column: string, definition: string): void => {
  if (!hasColumn(sqlite, table, column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
  }
}

export const runMigrations = (sqlite: MigratableDatabase, options: MigrationOptions = {}): void => {
  const ftsTokenizer = FTS_TOKENIZER_SQL[options.ftsTokenizer ?? DEFAULT_FTS_TOKENIZER]
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'viewer',
      totp_secret   TEXT,
      totp_enabled  INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_accounts (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL,
      provider         TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      email            TEXT NOT NULL,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_accounts_user_idx ON auth_accounts(user_id);
    CREATE INDEX IF NOT EXISTS auth_accounts_provider_idx ON auth_accounts(provider, provider_subject);

    CREATE TABLE IF NOT EXISTS oauth_states (
      state          TEXT PRIMARY KEY,
      provider       TEXT NOT NULL,
      nonce          TEXT NOT NULL,
      code_verifier  TEXT NOT NULL,
      redirect_after TEXT,
      expires_at     INTEGER NOT NULL,
      created_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passkeys (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      name         TEXT NOT NULL,
      public_key   TEXT NOT NULL,
      counter      INTEGER NOT NULL DEFAULT 0,
      transports   TEXT NOT NULL DEFAULT '[]',
      device_type  TEXT NOT NULL DEFAULT 'unknown',
      backed_up    INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id);

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      challenge  TEXT PRIMARY KEY,
      user_id    TEXT,
      purpose    TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS webauthn_challenges_user_idx ON webauthn_challenges(user_id);
    CREATE INDEX IF NOT EXISTS webauthn_challenges_expires_idx ON webauthn_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS groups (
      id          TEXT PRIMARY KEY,
      key         TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_memberships (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      group_id   TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS group_memberships_user_idx ON group_memberships(user_id);
    CREATE INDEX IF NOT EXISTS group_memberships_group_idx ON group_memberships(group_id);

    CREATE TABLE IF NOT EXISTS permission_grants (
      id           TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id   TEXT,
      action       TEXT NOT NULL,
      effect       TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS permission_grants_subject_idx ON permission_grants(subject_type, subject_id);

    CREATE TABLE IF NOT EXISTS page_rules (
      id           TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id   TEXT,
      action       TEXT NOT NULL,
      effect       TEXT NOT NULL,
      matcher      TEXT NOT NULL,
      pattern      TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS page_rules_subject_idx ON page_rules(subject_type, subject_id);
    CREATE INDEX IF NOT EXISTS page_rules_pattern_idx ON page_rules(pattern);

    CREATE TABLE IF NOT EXISTS pages (
      id            TEXT PRIMARY KEY,
      path          TEXT NOT NULL UNIQUE,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      rendered_html TEXT NOT NULL DEFAULT '',
      toc           TEXT NOT NULL DEFAULT '[]',
      content_type  TEXT NOT NULL DEFAULT 'markdown',
      lifecycle     TEXT NOT NULL DEFAULT 'active',
      status        TEXT NOT NULL DEFAULT 'draft',
      labels        TEXT NOT NULL DEFAULT '[]',
      owner_id      TEXT,
      review_at     INTEGER,
      space_key     TEXT NOT NULL DEFAULT 'main',
      locale        TEXT NOT NULL DEFAULT 'und',
      author_id     TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pages_updated_idx ON pages(updated_at);

    CREATE TABLE IF NOT EXISTS page_revisions (
      id          TEXT PRIMARY KEY,
      page_id     TEXT NOT NULL,
      path        TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      author_id   TEXT,
      action      TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS revisions_page_idx ON page_revisions(page_id);

    CREATE TABLE IF NOT EXISTS page_comments (
      id          TEXT PRIMARY KEY,
      page_id     TEXT NOT NULL,
      path        TEXT NOT NULL,
      body        TEXT NOT NULL,
      author_id   TEXT,
      resolved_at INTEGER,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_page_idx ON page_comments(page_id);
    CREATE INDEX IF NOT EXISTS comments_path_idx ON page_comments(path);

    CREATE TABLE IF NOT EXISTS page_analytics (
      path           TEXT PRIMARY KEY,
      views          INTEGER NOT NULL DEFAULT 0,
      last_viewed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id         TEXT PRIMARY KEY,
      filename   TEXT NOT NULL,
      storage_name TEXT NOT NULL DEFAULT '',
      mime       TEXT NOT NULL,
      size       INTEGER NOT NULL,
      author_id  TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id  TEXT NOT NULL,
      event_type TEXT NOT NULL,
      action     TEXT NOT NULL,
      path       TEXT NOT NULL,
      from_path  TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wiki_events_id_idx ON wiki_events(id);

    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      target_url  TEXT NOT NULL,
      secret      TEXT NOT NULL,
      event_types TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS webhook_subscriptions_enabled_idx ON webhook_subscriptions(enabled);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id              TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      event_id        TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      payload         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      response_status INTEGER,
      response_body   TEXT,
      error           TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      delivered_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS webhook_deliveries_subscription_idx ON webhook_deliveries(subscription_id);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx ON webhook_deliveries(status);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_next_attempt_idx ON webhook_deliveries(next_attempt_at);

    CREATE TABLE IF NOT EXISTS automation_rules (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      config     TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS automation_rules_enabled_idx ON automation_rules(enabled);
    CREATE INDEX IF NOT EXISTS automation_rules_type_idx ON automation_rules(type);
  `)

  // Full-text search index. Columns: page_id (returned, not searched), then the
  // three weighted text columns. `plain_text` holds the de-marked-down body.
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      page_id UNINDEXED,
      title,
      description,
      content,
      tokenize = '${ftsTokenizer}'
    );
  `)

  addColumn(sqlite, 'pages', 'lifecycle', "TEXT NOT NULL DEFAULT 'active'")
  addColumn(sqlite, 'pages', 'status', "TEXT NOT NULL DEFAULT 'draft'")
  addColumn(sqlite, 'pages', 'labels', "TEXT NOT NULL DEFAULT '[]'")
  addColumn(sqlite, 'pages', 'owner_id', 'TEXT')
  addColumn(sqlite, 'pages', 'review_at', 'INTEGER')
  addColumn(sqlite, 'pages', 'space_key', "TEXT NOT NULL DEFAULT 'main'")
  addColumn(sqlite, 'pages', 'locale', "TEXT NOT NULL DEFAULT 'und'")
  addColumn(sqlite, 'assets', 'storage_name', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'users', 'totp_secret', 'TEXT')
  addColumn(sqlite, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0')
}

/** Run migrations standalone: `bun src/db/migrate.ts`. */
if (import.meta.main) {
  const { loadEnv } = await import('../env.ts')
  const { createDb } = await import('./client.ts')
  const env = loadEnv()
  const db = createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer })
  db.$client.close()
  const target = env.database.driver === 'sqlite' ? env.database.path : env.database.replicaPath ?? env.database.url
  console.log(`✓ Migrations applied to ${target}`)
}
