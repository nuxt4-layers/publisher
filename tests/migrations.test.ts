import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PUBLISHER_MIGRATIONS, runPublisherMigrations } from '../server/database/migrations'
import { adminUrl, createTestDatabase, hasDatabase, requireDatabaseInCi } from './support/database'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('migrations (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>
  let admin: pg.Pool
  let other: pg.Pool
  const role = `publisher_runtime_${randomBytes(4).toString('hex')}`
  const password = randomBytes(12).toString('hex')

  beforeAll(async () => {
    database = await createTestDatabase()
    admin = new pg.Pool({ connectionString: database.url, max: 2 })
    other = new pg.Pool({ connectionString: database.url, max: 2 })
    await admin.query(`create role "${role}" login password '${password}'`)
  })

  afterAll(async () => {
    await admin?.end()
    await other?.end()
    await database?.drop()
    const cleanup = new pg.Client({ connectionString: adminUrl })
    await cleanup.connect()
    await cleanup.query(`drop role if exists "${role}"`)
    await cleanup.end()
  })

  it('applies each migration once, even when instances race', async () => {
    const runs = await Promise.all([runPublisherMigrations(admin, 'publisher', role), runPublisherMigrations(other, 'publisher', role)])
    const ids = PUBLISHER_MIGRATIONS.map(migration => migration.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(runs.flat().sort()).toEqual([...ids].sort())
    expect(runs.some(run => run.length === 0)).toBe(true)
    expect(await runPublisherMigrations(admin, 'publisher', role)).toEqual([])
    const { rows } = await admin.query(`select "id" from "publisher"."migration" order by "id"`)
    expect(rows.map(row => row.id)).toEqual([...ids].sort())
  })

  it('names its migrations in order, and refuses an unsafe schema or role name', async () => {
    const ids = PUBLISHER_MIGRATIONS.map(migration => migration.id)
    expect(ids).toEqual([...ids].sort())
    for (const migrationId of ids) expect(migrationId).toMatch(/^\d{4}_[a-z0-9_]+$/)
    await expect(runPublisherMigrations(admin, 'publisher"; drop table x; --')).rejects.toThrow(TypeError)
    await expect(runPublisherMigrations(admin, 'publisher', 'role"; --')).rejects.toThrow(TypeError)
  })

  it('gives the runtime role data access only: it owns nothing, alters nothing and never bypasses row security', async () => {
    const { rows: owned } = await admin.query(`select count(*)::int as "count" from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_roles r on r.oid = c.relowner where n.nspname = 'publisher' and r.rolname = $1`, [role])
    expect(owned[0].count).toBe(0)
    const { rows: flags } = await admin.query(`select "rolbypassrls", "rolsuper", "rolcreaterole", "rolcreatedb" from pg_roles where "rolname" = $1`, [role])
    expect(flags[0]).toEqual({ rolbypassrls: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false })

    const url = new URL(database.url)
    url.username = role
    url.password = password
    const runtime = new pg.Client({ connectionString: url.toString() })
    await runtime.connect()
    try {
      await runtime.query(`insert into "publisher"."outbox" ("event", "created_at") values ('{}', now())`)
      await expect(runtime.query(`create table "publisher"."x" ("y" int)`)).rejects.toThrow(/permission denied/)
      await expect(runtime.query(`alter table "publisher"."outbox" add column "z" int`)).rejects.toThrow(/must be owner/)
      await expect(runtime.query(`delete from "publisher"."migration"`)).rejects.toThrow(/permission denied/)
    }
    finally {
      await runtime.end()
    }
  })
})
