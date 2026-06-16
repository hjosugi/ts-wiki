/**
 * Schema DDL — including the FTS5 full-text index that Drizzle can't express.
 *
 * The pattern, learned from Wiki.js's PostgreSQL `tsvector` setup: weight the
 * title above the description above the body, and keep the search index in sync
 * with the source rows. Here we do that with a standalone FTS5 table that the
 * PageService updates inside the same transaction as the page write — explicit
 * effects, no hidden triggers.
 */
import { Database } from 'bun:sqlite'

/** FTS5 tokenizer. `unicode61` ranks prose well; switch to `trigram` for
 *  substring/CJK-heavy content (see README "Search"). */
export const FTS_TOKENIZER = "unicode61 remove_diacritics 2"

export const runMigrations = (sqlite: Database): void => {
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'viewer',
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id            TEXT PRIMARY KEY,
      path          TEXT NOT NULL UNIQUE,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      rendered_html TEXT NOT NULL DEFAULT '',
      toc           TEXT NOT NULL DEFAULT '[]',
      content_type  TEXT NOT NULL DEFAULT 'markdown',
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

    CREATE TABLE IF NOT EXISTS assets (
      id         TEXT PRIMARY KEY,
      filename   TEXT NOT NULL,
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
  `)

  // Full-text search index. Columns: page_id (returned, not searched), then the
  // three weighted text columns. `plain_text` holds the de-marked-down body.
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      page_id UNINDEXED,
      title,
      description,
      content,
      tokenize = '${FTS_TOKENIZER}'
    );
  `)
}

/** Run migrations standalone: `bun src/db/migrate.ts`. */
if (import.meta.main) {
  const { loadEnv } = await import('../env.ts')
  const env = loadEnv()
  const { dirname } = await import('node:path')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(dirname(env.databasePath), { recursive: true })
  const sqlite = new Database(env.databasePath, { create: true })
  runMigrations(sqlite)
  sqlite.close()
  console.log(`✓ Migrations applied to ${env.databasePath}`)
}
