import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PublisherSubject } from '../shared/contracts'
import { publisherPersonExportSchema } from '../shared/contracts'
import {
  createPublisherDocument,
  erasePublisherPerson,
  exportPublisherContent,
  exportPublisherPersonData,
  getPublishedDocument,
  getPublisherDocument,
  getPublisherFeed,
  importPublisherContent,
  listPublishedDocuments,
  listPublisherBacklinks,
  listPublisherDocuments,
  listPublisherModerationQueue,
  listPublisherSitemapEntries,
  receivePublisherSubmission,
  resolvePublisherPath,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { appraisal, bulletin } from './support/types'
import { id, person, World } from './support/world'

requireDatabaseInCi()

/**
 * Sites (docs/contracts.md §3.4): every document belongs to one site, is
 * addressed, listed, fed, linked and administered there only, and a
 * permission on one site reaches nothing on another.
 */
describe.skipIf(!hasDatabase)('sites (PostgreSQL)', () => {
  let harness: Harness
  let world: World
  const alice = id()
  const bob = id()
  let editor: PublisherSubject
  const ALPHA = 'alpha'
  const BRAVO = 'bravo'

  async function publish(siteId: string, slug: string, title: string, body = 'News.') {
    const document = await createPublisherDocument({ siteId, subject: editor, correlationId: id(), type: 'bulletin', content: { ...bulletin(slug, title), fields: { body, topic: 'general' } } })
    return transitionPublisherDocument({ siteId, subject: editor, correlationId: id(), documentId: document.id, request: { action: 'publish', expectedVersion: 1 } })
  }

  beforeAll(async () => {
    harness = await Harness.open()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    world = await harness.reset()
    for (const type of ['landing', 'appraisal', 'bulletin']) world.grantAll(alice, type)
    editor = person(alice, world.time)
  })

  it('gives each site its own address space: the same path on two sites is two documents', async () => {
    const onAlpha = await publish(ALPHA, 'same', 'Alpha news')
    const onBravo = await publish(BRAVO, 'same', 'Bravo news')
    expect(onAlpha.siteId).toBe(ALPHA)
    expect(onBravo.path).toBe(onAlpha.path)
    expect((await getPublishedDocument({ siteId: ALPHA, path: onAlpha.path! }))?.document.title).toBe('Alpha news')
    expect((await getPublishedDocument({ siteId: BRAVO, path: onAlpha.path! }))?.document.title).toBe('Bravo news')
  })

  it('never serves, lists, feeds or maps a document on another site', async () => {
    const document = await publish(ALPHA, 'only-alpha', 'Only on alpha')
    expect(await getPublishedDocument({ siteId: BRAVO, documentId: document.id })).toBeNull()
    expect(await resolvePublisherPath({ siteId: BRAVO, path: document.path! })).toEqual({ kind: 'none' })
    expect((await listPublishedDocuments({ siteId: BRAVO, type: 'bulletin' })).total).toBe(0)
    expect(await getPublisherFeed({ siteId: BRAVO, type: 'bulletin', format: 'rss', origin: 'https://bravo.test' })).not.toContain('Only on alpha')
    expect(await listPublisherSitemapEntries({ siteId: BRAVO })).toEqual([])
    expect(await listPublisherSitemapEntries({ siteId: ALPHA })).toHaveLength(1)
  })

  it('administers a document only on its own site, and asks the access-decision port about that site', async () => {
    const document = await createPublisherDocument({ siteId: ALPHA, subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('draft') })
    await expect(getPublisherDocument({ siteId: BRAVO, subject: editor, documentId: document.id })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(transitionPublisherDocument({ siteId: BRAVO, subject: editor, correlationId: id(), documentId: document.id, request: { action: 'publish', expectedVersion: 1 } })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await listPublisherDocuments({ siteId: BRAVO, subject: editor, type: 'bulletin' })).total).toBe(0)
    world.askedSites.length = 0
    await getPublisherDocument({ siteId: ALPHA, subject: editor, documentId: document.id })
    expect(world.askedSites).toEqual([ALPHA])
  })

  it('reaches nothing on another site with a permission on one', async () => {
    world.grantOn(BRAVO, bob, 'publisher.bulletin.view-draft', 'publisher.bulletin.edit', 'publisher.bulletin.publish')
    const subject = person(bob, world.time)
    await expect(createPublisherDocument({ siteId: ALPHA, subject, correlationId: id(), type: 'bulletin', content: bulletin('x') })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createPublisherDocument({ siteId: BRAVO, subject, correlationId: id(), type: 'bulletin', content: bulletin('x') })).resolves.toMatchObject({ siteId: BRAVO })
    const document = await createPublisherDocument({ siteId: ALPHA, subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('y') })
    await expect(getPublishedDocument({ siteId: ALPHA, documentId: document.id, viewer: subject, preview: true })).resolves.toBeNull()
  })

  it('resolves doc: links and backlinks within a site only', async () => {
    const target = await publish(ALPHA, 'target', 'Target')
    const sameSite = await publish(ALPHA, 'same-site', 'Same site', `[t](doc:${target.id})`)
    const otherSite = await publish(BRAVO, 'other-site', 'Other site', `[t](doc:${target.id})`)
    expect((await getPublishedDocument({ siteId: ALPHA, documentId: sameSite.id }))?.links.documents).toEqual({ [target.id]: target.path })
    expect((await getPublishedDocument({ siteId: BRAVO, documentId: otherSite.id }))?.links.documents).toEqual({ [target.id]: null })
    expect((await listPublisherBacklinks({ siteId: ALPHA, subject: editor, documentId: target.id })).map(link => link.documentId)).toEqual([sameSite.id])
  })

  it('keeps redirects to their site', async () => {
    let document = await publish(ALPHA, 'old', 'Moved')
    document = await transitionPublisherDocument({ siteId: ALPHA, subject: editor, correlationId: id(), documentId: document.id, request: { action: 'save', expectedVersion: 1, content: bulletin('new', 'Moved') } })
    await transitionPublisherDocument({ siteId: ALPHA, subject: editor, correlationId: id(), documentId: document.id, request: { action: 'publish', expectedVersion: 2 } })
    expect(await resolvePublisherPath({ siteId: ALPHA, path: '/bulletins/2026/10/21/old' })).toMatchObject({ kind: 'redirect' })
    expect(await resolvePublisherPath({ siteId: BRAVO, path: '/bulletins/2026/10/21/old' })).toEqual({ kind: 'none' })
  })

  it('moderates each site\'s submissions there only', async () => {
    await receivePublisherSubmission({ siteId: BRAVO, correlationId: id(), submitterId: bob, type: 'appraisal', content: appraisal(bob) })
    expect((await listPublisherModerationQueue({ siteId: ALPHA, subject: editor })).total).toBe(0)
    expect((await listPublisherModerationQueue({ siteId: BRAVO, subject: editor })).total).toBe(1)
  })

  it('exports a site\'s content, and imports it into another site', async () => {
    await publish(ALPHA, 'moving', 'Moving')
    const bundle = await exportPublisherContent({ siteId: ALPHA })
    expect(bundle.documents).toHaveLength(1)
    expect((await exportPublisherContent({ siteId: BRAVO })).documents).toEqual([])
    // Into another site of the same database, as new documents.
    const copy = { ...bundle, documents: bundle.documents.map(document => ({ ...document, id: id() })) }
    await importPublisherContent({ siteId: BRAVO, bundle: copy, correlationId: id() })
    expect((await getPublishedDocument({ siteId: BRAVO, path: '/bulletins/2026/10/21/moving' }))?.document).toMatchObject({ siteId: BRAVO, title: 'Moving' })
    expect((await harness.outbox()).at(-1)).toMatchObject({ type: 'publisher.content-imported', data: { siteId: BRAVO, documents: 1 } })
  })

  it('exports and erases a person\'s documents on every site, naming each one\'s site', async () => {
    for (const siteId of [ALPHA, BRAVO]) {
      const { documentId } = await receivePublisherSubmission({ siteId, correlationId: id(), submitterId: bob, type: 'appraisal', content: appraisal(bob) })
      await transitionPublisherDocument({ siteId, subject: editor, correlationId: id(), documentId, request: { action: 'moderate', expectedVersion: 1, outcome: 'accept' } })
    }
    const exported = publisherPersonExportSchema.parse(await exportPublisherPersonData({ identityId: bob }))
    expect(exported.documents.map(document => document.siteId).sort()).toEqual([ALPHA, BRAVO])
    expect(await erasePublisherPerson({ identityId: bob, correlationId: id() })).toEqual({ documents: 2, versions: 2 })
  })

  it('refuses a malformed site', async () => {
    await expect(createPublisherDocument({ siteId: 'Not A Site', subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('x') })).rejects.toMatchObject({ code: 'validation-failed', reason: 'not-a-site' })
    expect(await getPublishedDocument({ siteId: '../alpha', path: '/' })).toBeNull()
  })
})
