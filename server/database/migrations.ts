import type { PostgresPoolLike } from '../../shared/contracts'

/**
 * PRIVATE. Versioned, append-only migrations for the publisher's schema
 * (ADR-0002). `{{schema}}` is replaced with the validated, quoted schema
 * identifier. Never edit a released migration; add a new one.
 */
export const PUBLISHER_MIGRATIONS: readonly { id: string, sql: string }[] = [
  {
    id: '0001_documents_versions_links_outbox',
    sql: `
-- One row per document: its lifecycle, and the address it is published at.
create table {{schema}}."document" (
  "id" text primary key,
  "type" text not null,
  "status" text not null check ("status" in ('draft', 'in-review', 'scheduled', 'published', 'archived')),
  "latest_version" integer not null check ("latest_version" >= 1),
  "published_version" integer check ("published_version" >= 1),
  "review_version" integer check ("review_version" >= 1),
  "approval_id" text,
  -- Who asked the approval port, never an approver of their own request.
  "review_requester" text,
  "moderation" text check ("moderation" in ('pending', 'accepted', 'rejected')),
  "publish_at" timestamptz,
  "unpublish_at" timestamptz,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  "published_at" timestamptz,
  -- The address of the published version, while the document is published.
  "path" text,
  -- The address the newest version's content gives, for previews.
  "latest_path" text,
  check ("path" is null or "status" = 'published'),
  check ("status" <> 'published' or "published_version" is not null)
);
create unique index "document_path_idx" on {{schema}}."document" ("path") where "path" is not null;
create index "document_latest_path_idx" on {{schema}}."document" ("latest_path");
create index "document_type_idx" on {{schema}}."document" ("type", "status");
create index "document_due_idx" on {{schema}}."document" ("status", "publish_at", "unpublish_at") where "status" in ('scheduled', 'published');

-- Every saved version. subject_id is the person a personal-data type's version names.
create table {{schema}}."version" (
  "document_id" text not null references {{schema}}."document" ("id") on delete cascade,
  "version" integer not null check ("version" >= 1),
  "content" jsonb not null,
  "digest" text not null,
  "saved_at" timestamptz not null,
  "saved_by" text,
  "restored_from" integer,
  "subject_id" text,
  primary key ("document_id", "version")
);
create index "version_subject_idx" on {{schema}}."version" ("subject_id") where "subject_id" is not null;

-- doc: links of the newest and the published version of each document, by id.
create table {{schema}}."link" (
  "from_id" text not null references {{schema}}."document" ("id") on delete cascade,
  "to_id" text not null,
  primary key ("from_id", "to_id")
);
create index "link_to_idx" on {{schema}}."link" ("to_id");

-- Old addresses of a document.
create table {{schema}}."redirect" (
  "path" text primary key,
  "document_id" text not null references {{schema}}."document" ("id") on delete cascade
);
create index "redirect_document_idx" on {{schema}}."redirect" ("document_id");

-- Transactional outbox: written in the same transaction as the change.
create table {{schema}}."outbox" (
  "sequence" bigserial primary key,
  "event" jsonb not null,
  "created_at" timestamptz not null,
  "published_at" timestamptz
);
create index "outbox_unpublished_idx" on {{schema}}."outbox" ("sequence") where "published_at" is null;
`,
  },
]

const NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/

export function quoteSchema(schema: string): string {
  if (!NAME_PATTERN.test(schema)) throw new TypeError(`Invalid publisher schema name '${schema}'.`)
  return `"${schema}"`
}

interface Client {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  release(): void
}

/**
 * Applies pending migrations in order, once, serialised across instances by
 * a transaction-scoped advisory lock. With `runtimeRole`, grants that role
 * data access only: it owns nothing and never alters the schema.
 */
export async function runPublisherMigrations(pool: PostgresPoolLike, schema: string, runtimeRole?: string): Promise<string[]> {
  const quoted = quoteSchema(schema)
  if (runtimeRole !== undefined && !NAME_PATTERN.test(runtimeRole)) throw new TypeError(`Invalid runtime role name '${runtimeRole}'.`)
  const client = await pool.connect() as Client
  const applied: string[] = []
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`publisher-migrations:${schema}`])
    await client.query(`create schema if not exists ${quoted}`)
    await client.query(`create table if not exists ${quoted}."migration" ("id" text primary key, "applied_at" timestamptz not null default now())`)
    const { rows } = await client.query(`select "id" from ${quoted}."migration"`)
    const done = new Set(rows.map(row => row.id as string))
    for (const migration of PUBLISHER_MIGRATIONS) {
      if (done.has(migration.id)) continue
      await client.query(migration.sql.replaceAll('{{schema}}', quoted))
      await client.query(`insert into ${quoted}."migration" ("id") values ($1)`, [migration.id])
      applied.push(migration.id)
    }
    if (runtimeRole !== undefined) {
      const role = `"${runtimeRole}"`
      await client.query(`grant usage on schema ${quoted} to ${role}`)
      await client.query(`grant select, insert, update, delete on ${quoted}."document", ${quoted}."version", ${quoted}."link", ${quoted}."redirect", ${quoted}."outbox" to ${role}`)
      await client.query(`grant usage on sequence ${quoted}."outbox_sequence_seq" to ${role}`)
    }
    await client.query('commit')
    return applied
  }
  catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  }
  finally {
    client.release()
  }
}
