import pg from 'pg'
import type { PublisherTypeDeclarationInput } from '../../shared/contracts'
import {
  clearPublisherComposition,
  providePublisherAccessDecision,
  providePublisherApproval,
  providePublisherAssetResolver,
  providePublisherClock,
  providePublisherDatabase,
  providePublisherDocumentTypes,
  providePublisherEventSink,
  providePublisherTitleTemplate,
} from '../../server/utils/publisher-composition'
import { migratePublisherDatabase } from '../../server/utils/publisher-server'
import { createTestDatabase } from './database'
import { TEST_TYPES } from './types'
import { World } from './world'

/**
 * A publisher composed against a disposable database and the in-memory
 * ports, as a host's Nitro plugin would compose it. `reset` empties every
 * table the layer owns (whatever they are called) and supplies fresh ports.
 */
export class Harness {
  world = new World()

  private constructor(readonly pool: pg.Pool, private readonly drop: () => Promise<void>) {}

  static async open(): Promise<Harness> {
    const database = await createTestDatabase()
    const pool = new pg.Pool({ connectionString: database.url })
    const harness = new Harness(pool, database.drop)
    clearPublisherComposition()
    providePublisherDatabase({ dialect: 'postgres', pool })
    await migratePublisherDatabase()
    return harness
  }

  async reset(types: readonly PublisherTypeDeclarationInput[] = TEST_TYPES): Promise<World> {
    const { rows } = await this.pool.query<{ tablename: string }>(`select "tablename" from pg_tables where "schemaname" = 'publisher' and "tablename" <> 'migration'`)
    if (rows.length > 0) await this.pool.query(`truncate ${rows.map(row => `"publisher"."${row.tablename}"`).join(', ')} restart identity cascade`)
    clearPublisherComposition()
    this.world = new World()
    providePublisherDatabase({ dialect: 'postgres', pool: this.pool })
    providePublisherDocumentTypes(types)
    providePublisherAccessDecision(this.world.access)
    providePublisherApproval(this.world.approval)
    providePublisherClock(this.world.clock)
    providePublisherEventSink(this.world.sink)
    providePublisherAssetResolver(this.world.assetResolver)
    providePublisherTitleTemplate(this.world.titleTemplate)
    return this.world
  }

  /** The events written to the outbox, oldest first, without relaying them. */
  async outbox(): Promise<{ type: string, data: Record<string, unknown> }[]> {
    const { rows } = await this.pool.query<{ event: { type: string, data: Record<string, unknown> } }>(`select "event" from "publisher"."outbox" order by "sequence"`)
    return rows.map(row => row.event)
  }

  async close(): Promise<void> {
    clearPublisherComposition()
    await this.pool.end()
    await this.drop()
  }
}
