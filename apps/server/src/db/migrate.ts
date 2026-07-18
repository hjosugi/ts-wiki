/**
 * Schema DDL — including the FTS5 full-text index that Drizzle can't express.
 *
 * The pattern, learned from Wiki.js's PostgreSQL `tsvector` setup: weight the
 * title above the description above the body, and keep the search index in sync
 * with the source rows. Here we do that with a standalone FTS5 table that the
 * PageService updates inside the same transaction as the page write — explicit
 * effects, no hidden triggers.
 */
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import * as drizzleSchema from './schema.ts'
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
  /** Verify Drizzle schema after migration. Remote replicas verify after sync. */
  readonly verifySchema?: boolean
}

const hasColumn = (sqlite: MigratableDatabase, table: string, column: string): boolean =>
  sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => (row as { name?: string }).name?.toLowerCase() === column.toLowerCase())

const addColumn = (sqlite: MigratableDatabase, table: string, column: string, definition: string): boolean => {
  if (!hasColumn(sqlite, table, column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
    return true
  }
  return false
}

const assertSchemaMatchesDatabase = (sqlite: MigratableDatabase): void => {
  type ConfigTable = Parameters<typeof getTableConfig>[0]
  for (const candidate of Object.values(drizzleSchema)) {
    let config: ReturnType<typeof getTableConfig>
    try {
      config = getTableConfig(candidate as ConfigTable)
    } catch {
      continue
    }
    if (!config.name || !config.columns.length) continue
    const existingColumns = new Set(
      sqlite.prepare(`PRAGMA table_info("${config.name}")`).all()
        .map((row) => (row as { name?: string }).name?.toLowerCase())
        .filter((name): name is string => Boolean(name)),
    )
    const missingColumns = config.columns.map((column) => column.name).filter((name) => !existingColumns.has(name.toLowerCase()))
    if (missingColumns.length) {
      throw new Error(`Database schema drift: ${config.name} is missing columns ${missingColumns.join(', ')}`)
    }
    const existingIndexes = new Set(
      sqlite.prepare(`PRAGMA index_list("${config.name}")`).all()
        .map((row) => (row as { name?: string }).name)
        .filter((name): name is string => Boolean(name)),
    )
    const missingIndexes = config.indexes.map((index) => index.config.name).filter((name) => !existingIndexes.has(name))
    if (missingIndexes.length) {
      throw new Error(`Database index drift: ${config.name} is missing indexes ${missingIndexes.join(', ')}`)
    }
  }
}

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`

const slugifyPathSegment = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

const normalizePathLike = (value: unknown): string => {
  const path = typeof value === 'string' ? value : ''
  return path.split('/').map(slugifyPathSegment).filter(Boolean).join('/')
}

const normalizeLabelLike = (value: unknown): string => slugifyPathSegment(typeof value === 'string' ? value : '')

const migrateLegacyAutomationRules = (sqlite: MigratableDatabase): void => {
  const rows = sqlite
    .prepare("SELECT id, config FROM automation_rules WHERE type = 'page-updated-metadata'")
    .all() as Array<{ id?: unknown; config?: unknown }>
  for (const row of rows) {
    if (typeof row.id !== 'string' || typeof row.config !== 'string') continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(row.config) as Record<string, unknown>
    } catch {
      parsed = {}
    }
    const pathPrefix = normalizePathLike(parsed.pathPrefix)
    const label = normalizeLabelLike(parsed.label)
    const status = typeof parsed.status === 'string' ? parsed.status : undefined
    const actions: Record<string, unknown> = {}
    if (label) actions.addLabel = label
    if (status) actions.setStatus = status
    const config = {
      trigger: 'page.updated',
      conditions: pathPrefix ? { pathPrefix } : {},
      actions: Object.keys(actions).length ? actions : { addLabel: 'invalid' },
    }
    sqlite.exec(`
      UPDATE automation_rules
      SET type = 'event-rule',
          config = ${sqlString(JSON.stringify(config))}
      WHERE id = ${sqlString(row.id)};
    `)
  }
}

const createSearchTable = (sqlite: MigratableDatabase, ftsTokenizer: string): void => {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      page_id UNINDEXED,
      title,
      description,
      content,
      comments,
      assets,
      tokenize = '${ftsTokenizer}'
    );
  `)
}

const populateSearchTable = (sqlite: MigratableDatabase): void => {
  sqlite.exec(`
    DELETE FROM pages_fts;
    INSERT INTO pages_fts(page_id, title, description, content, comments, assets)
    SELECT
      p.id,
      p.title,
      p.description,
      p.content,
      coalesce((
        SELECT group_concat(pc.body, char(10))
        FROM page_comments pc
        WHERE pc.page_id = p.id
      ), ''),
      coalesce((
        SELECT group_concat(trim(a.filename || ' ' || a.folder), char(10))
        FROM assets a
        WHERE a.deleted_at IS NULL
          AND (
            p.content LIKE '%' || a.storage_name || '%'
            OR p.content LIKE '%' || a.filename || '%'
          )
      ), '')
    FROM pages p
    WHERE p.lifecycle = 'active';
  `)
}

export const runMigrations = (sqlite: MigratableDatabase, options: MigrationOptions = {}): void => {
  const ftsTokenizer = FTS_TOKENIZER_SQL[options.ftsTokenizer ?? DEFAULT_FTS_TOKENIZER]

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'viewer',
      totp_secret   TEXT,
	      totp_enabled  INTEGER NOT NULL DEFAULT 0,
	      disabled_at   INTEGER,
	      token_invalid_before INTEGER NOT NULL DEFAULT 0,
	      email_verified_at INTEGER,
	      profile_bio TEXT NOT NULL DEFAULT '',
	      profile_cover_url TEXT NOT NULL DEFAULT '',
	      profile_links TEXT NOT NULL DEFAULT '[]',
	      profile_favorite_pages TEXT NOT NULL DEFAULT '[]',
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

	    CREATE TABLE IF NOT EXISTS password_resets (
	      token      TEXT PRIMARY KEY,
	      user_id    TEXT NOT NULL,
	      expires_at INTEGER NOT NULL,
	      created_at INTEGER NOT NULL
	    );
	    CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
	    CREATE INDEX IF NOT EXISTS password_resets_expires_idx ON password_resets(expires_at);

	    CREATE TABLE IF NOT EXISTS email_verifications (
	      token      TEXT PRIMARY KEY,
	      user_id    TEXT NOT NULL,
	      email      TEXT NOT NULL,
	      expires_at INTEGER NOT NULL,
	      created_at INTEGER NOT NULL
	    );
	    CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications(user_id);
	    CREATE INDEX IF NOT EXISTS email_verifications_expires_idx ON email_verifications(expires_at);

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

    CREATE TABLE IF NOT EXISTS totp_recovery_codes (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      code_hash  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      used_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS totp_recovery_codes_user_idx ON totp_recovery_codes(user_id);
    CREATE INDEX IF NOT EXISTS totp_recovery_codes_used_idx ON totp_recovery_codes(used_at);

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      challenge  TEXT PRIMARY KEY,
      user_id    TEXT,
      purpose    TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS webauthn_challenges_user_idx ON webauthn_challenges(user_id);
    CREATE INDEX IF NOT EXISTS webauthn_challenges_expires_idx ON webauthn_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS api_keys (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      key_hash     TEXT NOT NULL UNIQUE,
      role         TEXT NOT NULL DEFAULT 'viewer',
      expires_at   INTEGER,
      last_used_at INTEGER,
      revoked_at   INTEGER,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS api_keys_expires_idx ON api_keys(expires_at);
    CREATE INDEX IF NOT EXISTS api_keys_revoked_idx ON api_keys(revoked_at);

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
      icon          TEXT NOT NULL DEFAULT '',
      cover_url     TEXT NOT NULL DEFAULT '',
      cover_position TEXT NOT NULL DEFAULT 'center',
      content       TEXT NOT NULL DEFAULT '',
      rendered_html TEXT NOT NULL DEFAULT '',
      toc           TEXT NOT NULL DEFAULT '[]',
      content_type  TEXT NOT NULL DEFAULT 'markdown',
      lifecycle     TEXT NOT NULL DEFAULT 'active',
      status        TEXT NOT NULL DEFAULT 'draft',
      labels        TEXT NOT NULL DEFAULT '[]',
      owner_id      TEXT,
      review_at     INTEGER,
      nav_order     INTEGER,
      pinned        INTEGER NOT NULL DEFAULT 0,
      space_key     TEXT NOT NULL DEFAULT 'main',
      locale        TEXT NOT NULL DEFAULT 'und',
      author_id     TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pages_updated_idx ON pages(updated_at);
    CREATE INDEX IF NOT EXISTS pages_nav_idx ON pages(pinned, nav_order, path);

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
    CREATE INDEX IF NOT EXISTS revisions_created_idx ON page_revisions(created_at);

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

    CREATE TABLE IF NOT EXISTS page_watchers (
      user_id   TEXT NOT NULL,
      path      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, path)
    );
    CREATE INDEX IF NOT EXISTS page_watchers_path_idx ON page_watchers(path);

    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      path       TEXT,
      message    TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '{}',
      read_at    INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at);
    CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(user_id, read_at);

    CREATE TABLE IF NOT EXISTS page_analytics (
      path           TEXT PRIMARY KEY,
      views          INTEGER NOT NULL DEFAULT 0,
      last_viewed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS page_redirects (
      from_path  TEXT PRIMARY KEY,
      to_path    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_shares (
      token      TEXT PRIMARY KEY,
      path       TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS page_shares_path_idx ON page_shares(path);
    CREATE INDEX IF NOT EXISTS page_shares_created_by_idx ON page_shares(created_by);

    CREATE TABLE IF NOT EXISTS page_templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon        TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      metadata    TEXT NOT NULL DEFAULT '{}',
      created_by  TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS page_templates_name_idx ON page_templates(name);
    CREATE INDEX IF NOT EXISTS page_templates_updated_idx ON page_templates(updated_at);

    CREATE TABLE IF NOT EXISTS site_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id    TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, key)
    );
    CREATE INDEX IF NOT EXISTS user_preferences_user_idx ON user_preferences(user_id);

    CREATE TABLE IF NOT EXISTS link_previews (
      url          TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      provider     TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL DEFAULT '',
      image        TEXT,
      author       TEXT,
      site_name    TEXT,
      content_type TEXT,
      data         TEXT NOT NULL DEFAULT '{}',
      fetched_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS link_previews_expires_idx ON link_previews(expires_at);
    CREATE INDEX IF NOT EXISTS link_previews_kind_idx ON link_previews(kind);

    CREATE TABLE IF NOT EXISTS assets (
      id         TEXT PRIMARY KEY,
      filename   TEXT NOT NULL,
      storage_name TEXT NOT NULL DEFAULT '',
      folder     TEXT NOT NULL DEFAULT '',
      mime       TEXT NOT NULL,
      size       INTEGER NOT NULL,
      author_id  TEXT,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS page_asset_refs (
      page_id  TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      PRIMARY KEY (page_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS page_asset_refs_asset_idx ON page_asset_refs(asset_id);

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

    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      bucket_key TEXT NOT NULL,
      hit_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rate_limit_hits_bucket_idx ON rate_limit_hits(bucket_key, hit_at);
    CREATE INDEX IF NOT EXISTS rate_limit_hits_time_idx ON rate_limit_hits(hit_at);

    CREATE TABLE IF NOT EXISTS realtime_tickets (
      ticket     TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS realtime_tickets_expires_idx ON realtime_tickets(expires_at);

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
      priority   INTEGER NOT NULL DEFAULT 0,
      stop_on_match INTEGER NOT NULL DEFAULT 0,
      config     TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS automation_rules_enabled_idx ON automation_rules(enabled);
    CREATE INDEX IF NOT EXISTS automation_rules_type_idx ON automation_rules(type);
    CREATE INDEX IF NOT EXISTS automation_rules_order_idx ON automation_rules(enabled, priority, created_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT NOT NULL,
      user_id    TEXT,
      path       TEXT,
      data       TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log(action);
    CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id);
  `)

  // Full-text search index. Columns: page_id (returned, not searched), then
  // weighted title/summary/body plus lower-weight comment and asset metadata.
  createSearchTable(sqlite, ftsTokenizer)
  if (!hasColumn(sqlite, 'pages_fts', 'comments') || !hasColumn(sqlite, 'pages_fts', 'assets')) {
    sqlite.exec('DROP TABLE IF EXISTS pages_fts;')
    createSearchTable(sqlite, ftsTokenizer)
    populateSearchTable(sqlite)
  }

  addColumn(sqlite, 'pages', 'lifecycle', "TEXT NOT NULL DEFAULT 'active'")
  addColumn(sqlite, 'pages', 'status', "TEXT NOT NULL DEFAULT 'draft'")
  addColumn(sqlite, 'pages', 'labels', "TEXT NOT NULL DEFAULT '[]'")
  addColumn(sqlite, 'pages', 'icon', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'pages', 'cover_url', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'pages', 'cover_position', "TEXT NOT NULL DEFAULT 'center'")
  addColumn(sqlite, 'pages', 'owner_id', 'TEXT')
  addColumn(sqlite, 'pages', 'review_at', 'INTEGER')
  addColumn(sqlite, 'pages', 'publish_at', 'INTEGER')
  addColumn(sqlite, 'pages', 'nav_order', 'INTEGER')
  addColumn(sqlite, 'pages', 'pinned', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(sqlite, 'pages', 'space_key', "TEXT NOT NULL DEFAULT 'main'")
  addColumn(sqlite, 'pages', 'locale', "TEXT NOT NULL DEFAULT 'und'")
  sqlite.exec('CREATE INDEX IF NOT EXISTS pages_nav_idx ON pages(pinned, nav_order, path);')
  addColumn(sqlite, 'assets', 'storage_name', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'assets', 'folder', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'assets', 'deleted_at', 'INTEGER')
  addColumn(sqlite, 'users', 'totp_secret', 'TEXT')
  addColumn(sqlite, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(sqlite, 'users', 'disabled_at', 'INTEGER')
  addColumn(sqlite, 'users', 'token_invalid_before', 'INTEGER NOT NULL DEFAULT 0')
  const addedEmailVerifiedAt = addColumn(sqlite, 'users', 'email_verified_at', 'INTEGER')
  addColumn(sqlite, 'users', 'profile_bio', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'users', 'profile_cover_url', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'users', 'profile_links', "TEXT NOT NULL DEFAULT '[]'")
  addColumn(sqlite, 'users', 'profile_favorite_pages', "TEXT NOT NULL DEFAULT '[]'")
  addColumn(sqlite, 'link_previews', 'kind', "TEXT NOT NULL DEFAULT 'unfurl'")
  addColumn(sqlite, 'link_previews', 'provider', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'link_previews', 'title', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'link_previews', 'description', "TEXT NOT NULL DEFAULT ''")
  addColumn(sqlite, 'link_previews', 'image', 'TEXT')
  addColumn(sqlite, 'link_previews', 'author', 'TEXT')
  addColumn(sqlite, 'link_previews', 'site_name', 'TEXT')
  addColumn(sqlite, 'link_previews', 'content_type', 'TEXT')
  addColumn(sqlite, 'link_previews', 'data', "TEXT NOT NULL DEFAULT '{}'")
  addColumn(sqlite, 'link_previews', 'fetched_at', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(sqlite, 'link_previews', 'expires_at', 'INTEGER NOT NULL DEFAULT 0')
  sqlite.exec('CREATE INDEX IF NOT EXISTS link_previews_expires_idx ON link_previews(expires_at);')
  sqlite.exec('CREATE INDEX IF NOT EXISTS link_previews_kind_idx ON link_previews(kind);')
  addColumn(sqlite, 'automation_rules', 'priority', 'INTEGER NOT NULL DEFAULT 0')
  addColumn(sqlite, 'automation_rules', 'stop_on_match', 'INTEGER NOT NULL DEFAULT 0')
  sqlite.exec('CREATE INDEX IF NOT EXISTS automation_rules_order_idx ON automation_rules(enabled, priority, created_at);')
  migrateLegacyAutomationRules(sqlite)
  // Existing accounts predate verification policy and are grandfathered once,
  // only when this migration actually introduces the column. Pending accounts
  // created after that must stay pending across restarts and search rebuilds.
  if (addedEmailVerifiedAt) {
    sqlite.exec('UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;')
  }
  sqlite.exec(`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ${Date.now()});`)
  if (options.verifySchema !== false) assertSchemaMatchesDatabase(sqlite)
}

export const verifyDatabaseSchema = (sqlite: MigratableDatabase): void => {
  assertSchemaMatchesDatabase(sqlite)
}

export const runMigrationsAtomically = (sqlite: MigratableDatabase, options: MigrationOptions = {}): void => {
  sqlite.exec('BEGIN IMMEDIATE;')
  try {
    runMigrations(sqlite, options)
    sqlite.exec('COMMIT;')
  } catch (error) {
    try {
      sqlite.exec('ROLLBACK;')
    } catch {
      /* preserve the migration error */
    }
    throw error
  }
}

/** Run migrations standalone: `bun src/db/migrate.ts`. */
if (import.meta.main) {
  const { loadEnv } = await import('../env.ts')
  const { createDb } = await import('./client.ts')
  const env = loadEnv()
  const db = createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer })
  db.$client.close()
  const target =
    env.database.driver === 'sqlite'
      ? env.database.path
      : env.database.driver === 'libsql'
        ? env.database.replicaPath ?? env.database.url
        : env.database.url
  console.log(`✓ Migrations applied to ${target}`)
}
