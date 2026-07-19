const errorText = (error: unknown, depth = 0): string => {
  if (depth > 5 || error == null) return ''
  // Driver errors are often wrapped (e.g. Drizzle's "Failed query" error holds
  // the real Postgres error on `.cause`), so fold the whole cause chain in.
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    const code = (error as { code?: unknown }).code
    return `${String(code ?? '')} ${error.name} ${error.message} ${errorText(cause, depth + 1)}`
  }
  if (typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown; cause?: unknown }
    return `${String(value.code ?? '')} ${String(value.message ?? '')} ${errorText(value.cause, depth + 1)}`
  }
  return String(error)
}

export const isUniqueConstraintError = (error: unknown): boolean =>
  // SQLite text codes/messages, PostgreSQL unique_violation (SQLSTATE 23505),
  // and MySQL/MariaDB duplicate key (ER_DUP_ENTRY / errno 1062).
  /SQLITE_CONSTRAINT_(?:UNIQUE|PRIMARYKEY)|UNIQUE constraint failed|PRIMARY KEY constraint failed|duplicate key value violates unique constraint|\b23505\b|ER_DUP_ENTRY|Duplicate entry/i.test(
    errorText(error),
  )
