import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { publisherEventSchema } from '../shared/contracts'
import {
  createPublisherDocument,
  erasePublisherPerson,
  exportPublisherContent,
  receivePublisherSubmission,
  relayPublisherOutbox,
  runPublisherMaintenance,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { appraisal, bulletin, landing } from './support/types'
import { id, person, World } from './support/world'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('events (PostgreSQL)', () => {
  let harness: Harness
  let world: World
  const alice = id()

  beforeAll(async () => {
    harness = await Harness.open()
  })

  afterAll(async () => {
    await harness?.pool.query('drop trigger if exists "refuse_outbox" on "publisher"."outbox"').catch(() => {})
    await harness?.close()
  })

  beforeEach(async () => {
    world = await harness.reset()
    for (const type of ['landing', 'appraisal', 'bulletin']) world.grantAll(alice, type)
  })

  it('writes events that carry identifiers, codes and times only, for every kind of change', async () => {
    const editor = person(alice, world.time)
    const act = (documentId: string, request: Parameters<typeof transitionPublisherDocument>[0]['request']) =>
      transitionPublisherDocument({ subject: editor, correlationId: id(), documentId, request })
    const secret = 'Confidential launch of the Zephyr'
    const page = await createPublisherDocument({ subject: editor, correlationId: id(), type: 'landing', content: landing('zephyr-launch', secret, secret) })
    await act(page.id, { action: 'submit', expectedVersion: 1 })
    world.approve(world.approvalFor(page.id)!, id())
    await act(page.id, { action: 'publish', expectedVersion: 1, publishAt: new Date(world.time.getTime() + 60_000).toISOString() })
    world.advance(1)
    await runPublisherMaintenance()
    await act(page.id, { action: 'save', expectedVersion: 1, content: landing('zephyr-renamed', secret, secret) })
    const carol = id()
    const { documentId } = await receivePublisherSubmission({ correlationId: id(), submitterId: carol, type: 'appraisal', content: appraisal(carol, { words: secret }) })
    await act(documentId, { action: 'moderate', expectedVersion: 1, outcome: 'accept' })
    await erasePublisherPerson({ identityId: carol, correlationId: id() })

    const events = await harness.outbox()
    expect(events.map(event => event.type)).toEqual([
      'publisher.document-created',
      'publisher.review-requested',
      'publisher.document-scheduled',
      'publisher.document-published',
      'publisher.document-saved',
      'publisher.submission-received',
      'publisher.submission-moderated',
      'publisher.document-published',
      'publisher.document-unpublished',
      'publisher.person-erased',
    ])
    for (const event of events) {
      expect(publisherEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true)
      expect(JSON.stringify(event)).not.toMatch(/Zephyr|zephyr|Splendid/)
    }
  })

  it('writes an event in the same transaction as its change: neither without the other', async () => {
    const editor = person(alice, world.time)
    await harness.pool.query(`create or replace function "publisher"."refuse_outbox"() returns trigger language plpgsql as $$ begin raise exception 'outbox refused'; end $$`)
    await harness.pool.query(`create trigger "refuse_outbox" before insert on "publisher"."outbox" for each row execute function "publisher"."refuse_outbox"()`)
    try {
      await expect(createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('atomic') })).rejects.toMatchObject({ code: 'unavailable' })
    }
    finally {
      await harness.pool.query('drop trigger "refuse_outbox" on "publisher"."outbox"')
    }
    expect((await exportPublisherContent()).documents).toEqual([])

    // A refused change writes no event either.
    const document = await createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('atomic') })
    await expect(transitionPublisherDocument({ subject: editor, correlationId: id(), documentId: document.id, request: { action: 'save', expectedVersion: 7, content: bulletin('atomic') } })).rejects.toMatchObject({ reason: 'version-stale' })
    expect((await harness.outbox()).map(event => event.type)).toEqual(['publisher.document-created'])
  })

  it('relays events in order, at least once, carrying the correlation and the actor', async () => {
    const editor = person(alice, world.time)
    const correlationId = id()
    const document = await createPublisherDocument({ subject: editor, correlationId, type: 'bulletin', content: bulletin('relayed') })
    await transitionPublisherDocument({ subject: editor, correlationId: id(), documentId: document.id, request: { action: 'publish', expectedVersion: 1 } })
    expect(await relayPublisherOutbox({ limit: 1 })).toBe(1)
    expect(await relayPublisherOutbox()).toBe(1)
    expect(world.published.map(event => event.type)).toEqual(['publisher.document-created', 'publisher.document-published'])
    expect(world.published[0]).toMatchObject({ correlationId, actorId: alice, data: { documentId: document.id, type: 'bulletin', version: 1 } })
  })
})
