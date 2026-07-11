const errorText = (error: unknown): string => {
  if (error instanceof Error) return `${error.name} ${error.message}`
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown }
    return `${String(value.code ?? '')} ${String(value.message ?? '')}`
  }
  return String(error)
}

export const isUniqueConstraintError = (error: unknown): boolean =>
  /SQLITE_CONSTRAINT_(?:UNIQUE|PRIMARYKEY)|UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(errorText(error))
