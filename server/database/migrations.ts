import type { PostgresPoolLike } from '../../shared/contracts'
import { pending } from '../../shared/pending'

/**
 * PRIVATE. Versioned, append-only migrations for the publisher's schema
 * (ADR-0002). Never edit a released migration; add a new one.
 */
export const PUBLISHER_MIGRATIONS: readonly { id: string, sql: string }[] = []

/**
 * Applies pending migrations in order, once, serialised across instances by
 * a transaction-scoped advisory lock. With `runtimeRole`, grants that role
 * data access only: it owns nothing and never alters the schema.
 */
export async function runPublisherMigrations(pool: PostgresPoolLike, schema: string, runtimeRole?: string): Promise<string[]> {
  return pending(`runPublisherMigrations(${typeof pool}, ${schema}, ${runtimeRole})`)
}
