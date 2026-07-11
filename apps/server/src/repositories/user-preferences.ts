/**
 * Driver-neutral persistence contract for user preferences.
 *
 * Service code depends on this interface instead of Drizzle or a concrete
 * database schema. All methods are asynchronous even when the active adapter
 * is backed by synchronous SQLite, so remote and pooled drivers can implement
 * the same contract without changing callers.
 */
export interface StoredUserPreference {
  readonly userId: string
  readonly key: string
  readonly value: string
  readonly updatedAt: number
}

export interface UserPreferenceMutation {
  readonly key: string
  /** Null deletes the stored preference. */
  readonly value: string | null
}

export interface UserPreferenceRepository {
  listForUser(userId: string): Promise<readonly StoredUserPreference[]>
  applyForUser(userId: string, mutations: readonly UserPreferenceMutation[], updatedAt: number): Promise<void>
}
