import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PublisherCompositionError } from '../shared/contracts'
import {
  clearPublisherComposition,
  providePublisherAccessDecision,
  providePublisherApproval,
  providePublisherDatabase,
  providePublisherDocumentTypes,
  providePublisherEventSink,
  usePublisherRegistry,
} from '../server/utils/publisher-composition'
import {
  checkPublisherComposition,
  createPublisherDocument,
  getPublishedDocument,
  relayPublisherOutbox,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { appraisalType, bulletin, bulletinType, landing, landingType, TEST_TYPES } from './support/types'
import { id, person, World, SITE } from './support/world'

requireDatabaseInCi()

describe('composition: start-up', () => {
  afterEach(() => clearPublisherComposition())

  it('starts with no type registered', () => {
    clearPublisherComposition()
    expect(usePublisherRegistry().size).toBe(0)
  })

  it('fails closed at start-up on a duplicate, an invalid declaration or a risk below the floor, keeping the registration in force', () => {
    providePublisherDocumentTypes([bulletinType])
    expect(() => providePublisherDocumentTypes([landingType, landingType])).toThrow(/twice/)
    expect(() => providePublisherDocumentTypes([{ ...bulletinType, type: 'Not A Key' }])).toThrow()
    expect(() => providePublisherDocumentTypes([{ ...bulletinType, lifecycle: { ...bulletinType.lifecycle, risks: { publish: 'low' } } }])).toThrow(/floor/)
    expect([...usePublisherRegistry().keys()]).toEqual(['bulletin'])
  })

  it('refuses malformed ports when they are supplied', () => {
    expect(() => providePublisherDatabase({ dialect: 'mysql' } as never)).toThrow(TypeError)
    expect(() => providePublisherAccessDecision({} as never)).toThrow(TypeError)
    expect(() => providePublisherApproval({ request: async () => ({ approvalId: 'x' }) } as never)).toThrow(TypeError)
    expect(() => providePublisherEventSink({} as never)).toThrow(TypeError)
  })

  it('fails closed without the database: no implicit store', async () => {
    providePublisherDocumentTypes(TEST_TYPES)
    const subject = person(id(), new Date())
    await expect(createPublisherDocument({ siteId: SITE, subject, correlationId: id(), type: 'bulletin', content: bulletin('a') })).rejects.toBeInstanceOf(PublisherCompositionError)
    await expect(getPublishedDocument({ siteId: SITE, path: '/anything' })).rejects.toBeInstanceOf(PublisherCompositionError)
    await expect(checkPublisherComposition()).rejects.toBeInstanceOf(PublisherCompositionError)
  })
})

describe.skipIf(!hasDatabase)('composition: required ports fail closed (PostgreSQL)', () => {
  let harness: Harness
  let world: World

  beforeAll(async () => {
    harness = await Harness.open()
  })

  afterAll(async () => {
    await harness?.close()
  })

  it('passes the start-up check when everything is supplied', async () => {
    world = await harness.reset()
    await expect(checkPublisherComposition()).resolves.toBeUndefined()
  })

  it('fails closed at start-up when the database holds a type the host no longer registers', async () => {
    world = await harness.reset()
    const alice = id()
    world.grantAll(alice, 'bulletin')
    await createPublisherDocument({ siteId: SITE, subject: person(alice, world.time), correlationId: id(), type: 'bulletin', content: bulletin('kept') })
    providePublisherDocumentTypes([landingType, appraisalType])
    await expect(checkPublisherComposition()).rejects.toThrow(/bulletin/)
    // Nor is the stored document served as something else.
    await expect(getPublishedDocument({ siteId: SITE, path: '/bulletins/2026/10/21/kept' })).rejects.toBeInstanceOf(PublisherCompositionError)
  })

  it('refuses a document of an unregistered type', async () => {
    world = await harness.reset()
    const alice = id()
    world.grant(alice, 'publisher.recipe.edit')
    await expect(createPublisherDocument({ siteId: SITE, subject: person(alice, world.time), correlationId: id(), type: 'recipe', content: bulletin('x') })).rejects.toMatchObject({ code: 'validation-failed', reason: 'unknown-type' })
  })

  it('fails closed without the access decision', async () => {
    world = await harness.reset()
    clearPublisherComposition()
    providePublisherDatabase({ dialect: 'postgres', pool: harness.pool })
    providePublisherDocumentTypes(TEST_TYPES)
    providePublisherEventSink(world.sink)
    await expect(createPublisherDocument({ siteId: SITE, subject: person(id(), world.time), correlationId: id(), type: 'bulletin', content: bulletin('a') })).rejects.toBeInstanceOf(PublisherCompositionError)
    await expect(checkPublisherComposition()).rejects.toThrow(/AccessDecision/)
  })

  it('fails closed when a type needs review and no approval port is supplied, recording nothing', async () => {
    world = await harness.reset()
    const alice = id()
    world.grantAll(alice, 'landing')
    const subject = person(alice, world.time)
    const created = await createPublisherDocument({ siteId: SITE, subject, correlationId: id(), type: 'landing', content: landing('about') })
    clearPublisherComposition()
    providePublisherDatabase({ dialect: 'postgres', pool: harness.pool })
    providePublisherDocumentTypes(TEST_TYPES)
    providePublisherAccessDecision(world.access)
    providePublisherEventSink(world.sink)
    await expect(transitionPublisherDocument({ siteId: SITE, subject, correlationId: id(), documentId: created.id, request: { action: 'submit', expectedVersion: 1 } })).rejects.toBeInstanceOf(PublisherCompositionError)
    await expect(checkPublisherComposition()).rejects.toThrow(/Approval/)
    expect((await harness.outbox()).map(event => event.type)).toEqual(['publisher.document-created'])
  })

  it('fails closed when a port fails: unavailable, and nothing recorded', async () => {
    world = await harness.reset()
    const alice = id()
    world.grantAll(alice, 'bulletin')
    world.failing = true
    await expect(createPublisherDocument({ siteId: SITE, subject: person(alice, world.time), correlationId: id(), type: 'bulletin', content: bulletin('a') })).rejects.toMatchObject({ code: 'unavailable' })
    expect(await harness.outbox()).toEqual([])
  })

  it('relays only to the event sink, and keeps events when it fails', async () => {
    world = await harness.reset()
    const alice = id()
    world.grantAll(alice, 'bulletin')
    await createPublisherDocument({ siteId: SITE, subject: person(alice, world.time), correlationId: id(), type: 'bulletin', content: bulletin('a') })
    world.sinkFailing = true
    await expect(relayPublisherOutbox()).rejects.toThrow()
    world.sinkFailing = false
    expect(await relayPublisherOutbox()).toBe(1)
    expect(await relayPublisherOutbox()).toBe(0)
    expect(world.published.map(event => event.type)).toEqual(['publisher.document-created'])
  })
})
