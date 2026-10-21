import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PublisherActionRequestInput, PublisherDocument, PublisherSubject } from '../shared/contracts'
import {
  createPublisherDocument,
  getPublishedDocument,
  listPublisherBacklinks,
  listPublisherSitemapEntries,
  resolvePublisherPath,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { bulletin } from './support/types'
import { id, person, World } from './support/world'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('addresses and links (PostgreSQL)', () => {
  let harness: Harness
  let world: World
  const alice = id()
  let editor: PublisherSubject

  const act = (document: PublisherDocument, request: PublisherActionRequestInput) =>
    transitionPublisherDocument({ subject: editor, correlationId: id(), documentId: document.id, request })

  async function publishBulletin(slug: string, body = 'News.', title = 'Bulletin'): Promise<PublisherDocument> {
    const document = await createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: { ...bulletin(slug, title), fields: { body, topic: 'general' } } })
    return act(document, { action: 'publish', expectedVersion: 1 })
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

  it('resolves any request path to a document of any type, a redirect or nothing', async () => {
    const document = await publishBulletin('hello')
    expect(document.path).toBe('/bulletins/2026/10/21/hello')
    const found = await resolvePublisherPath({ path: '/bulletins/2026/10/21/hello' })
    expect(found).toMatchObject({ kind: 'document', rendered: { document: { id: document.id }, preview: false } })
    expect(await resolvePublisherPath({ path: '/bulletins/2026/10/21/missing' })).toEqual({ kind: 'none' })
    expect(await resolvePublisherPath({ path: '/../etc/passwd' })).toEqual({ kind: 'none' })
    // A trailing slash is the same address, not a second one.
    expect(await resolvePublisherPath({ path: '/bulletins/2026/10/21/hello/' })).toMatchObject({ kind: 'redirect', to: '/bulletins/2026/10/21/hello' })
  })

  it('refuses an address another document holds, and an address on a type without one', async () => {
    await publishBulletin('taken')
    // A draft may hold an address another document is published at; publishing it may not.
    const second = await createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('taken', 'Second') })
    await expect(act(second, { action: 'publish', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'address-taken' })
    await expect(createPublisherDocument({ subject: editor, correlationId: id(), type: 'appraisal', content: { locale: 'en-GB', title: 'x', slug: 'x', fields: { authorId: id(), stars: 3, words: 'x' } } })).rejects.toMatchObject({ code: 'validation-failed', reason: 'address-not-allowed' })
    await expect(createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: { ...bulletin('x'), slug: null } })).rejects.toMatchObject({ code: 'validation-failed', reason: 'address-required' })
  })

  it('records a redirect when a published document\'s address changes, and the old address redirects', async () => {
    let document = await publishBulletin('old-name')
    document = await act(document, { action: 'save', expectedVersion: 1, content: bulletin('new-name') })
    // Saved, not yet published: the old address still serves the published version.
    expect((await resolvePublisherPath({ path: '/bulletins/2026/10/21/old-name' })).kind).toBe('document')
    document = await act(document, { action: 'publish', expectedVersion: 2 })
    expect(await resolvePublisherPath({ path: '/bulletins/2026/10/21/old-name' })).toEqual({ kind: 'redirect', to: '/bulletins/2026/10/21/new-name', status: 301 })
    expect((await harness.outbox()).filter(event => event.type === 'publisher.address-changed')).toEqual([expect.objectContaining({ data: { documentId: document.id, type: 'bulletin', redirectRecorded: true } })])

    // A second rename redirects both earlier addresses straight to the newest, never in a chain.
    document = await act(document, { action: 'save', expectedVersion: 2, content: bulletin('newest-name') })
    await act(document, { action: 'publish', expectedVersion: 3 })
    for (const old of ['old-name', 'new-name']) {
      expect(await resolvePublisherPath({ path: `/bulletins/2026/10/21/${old}` })).toEqual({ kind: 'redirect', to: '/bulletins/2026/10/21/newest-name', status: 301 })
    }
    // A new document may take an old address back: the document wins over the redirect.
    const reclaimed = await publishBulletin('old-name', 'Reclaimed.')
    expect(await resolvePublisherPath({ path: '/bulletins/2026/10/21/old-name' })).toMatchObject({ kind: 'document', rendered: { document: { id: reclaimed.id } } })
  })

  it('stops redirecting once the target is no longer published', async () => {
    let document = await publishBulletin('first')
    document = await act(document, { action: 'save', expectedVersion: 1, content: bulletin('second') })
    document = await act(document, { action: 'publish', expectedVersion: 2 })
    await act(document, { action: 'unpublish', expectedVersion: 2, acknowledgedLinks: 0 })
    expect(await resolvePublisherPath({ path: '/bulletins/2026/10/21/first' })).toEqual({ kind: 'none' })
  })

  it('keeps doc: links through renames, and renders them as text while the target is unpublished', async () => {
    let target = await publishBulletin('target')
    const source = await publishBulletin('source', `See [the target](doc:${target.id}).`)
    expect((await getPublishedDocument({ documentId: source.id }))?.links.documents).toEqual({ [target.id]: '/bulletins/2026/10/21/target' })

    target = await act(target, { action: 'save', expectedVersion: 1, content: bulletin('renamed') })
    target = await act(target, { action: 'publish', expectedVersion: 2 })
    expect((await getPublishedDocument({ documentId: source.id }))?.links.documents).toEqual({ [target.id]: '/bulletins/2026/10/21/renamed' })

    await act(target, { action: 'unpublish', expectedVersion: 2, acknowledgedLinks: 1 })
    expect((await getPublishedDocument({ documentId: source.id }))?.links.documents).toEqual({ [target.id]: null })
  })

  it('lists every document linking to a given one, and makes unpublishing it acknowledge them', async () => {
    const target = await publishBulletin('linked')
    const link = `[x](doc:${target.id})`
    const published = await publishBulletin('from-published', link)
    const draft = await createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: { ...bulletin('from-draft'), fields: { body: `Twice: ${link} ${link}`, topic: 'general' } } })
    const page = await createPublisherDocument({ subject: editor, correlationId: id(), type: 'landing', content: { locale: 'en-GB', title: 'A landing', slug: 'a-landing', fields: { intro: 'Intro', section: 'company', blocks: [{ block: 'prose', body: `In a block: ${link}` }] } } })
    // A link only an older version held no longer counts.
    let stale = await publishBulletin('from-stale', link)
    stale = await act(stale, { action: 'save', expectedVersion: 1, content: bulletin('from-stale') })
    stale = await act(stale, { action: 'publish', expectedVersion: 2 })
    await publishBulletin('unrelated', 'Nothing to see.')

    const backlinks = await listPublisherBacklinks({ subject: editor, documentId: target.id })
    expect(backlinks.map(backlink => backlink.documentId).sort()).toEqual([published.id, draft.id, page.id].sort())
    expect(backlinks.find(backlink => backlink.documentId === draft.id)).toMatchObject({ type: 'bulletin', status: 'draft', title: 'Bulletin' })

    // A viewer who may not see the linking type's drafts still sees that it links, without its title.
    const bob = id()
    world.grant(bob, 'publisher.bulletin.view-draft', 'publisher.bulletin.publish')
    const partial = await listPublisherBacklinks({ subject: person(bob, world.time), documentId: target.id })
    expect(partial).toHaveLength(3)
    expect(partial.find(backlink => backlink.documentId === page.id)).toMatchObject({ type: 'landing', title: null })

    await expect(act(target, { action: 'unpublish', expectedVersion: 1, acknowledgedLinks: 0 })).rejects.toMatchObject({ code: 'conflict', reason: 'still-linked' })
    await expect(act(target, { action: 'archive', expectedVersion: 1, acknowledgedLinks: 2 })).rejects.toMatchObject({ code: 'conflict', reason: 'still-linked' })
    await expect(act(target, { action: 'unpublish', expectedVersion: 1, acknowledgedLinks: 3 })).resolves.toMatchObject({ status: 'draft' })
  })

  it('lists sitemap entries for published, addressed documents only', async () => {
    const shown = await publishBulletin('in-sitemap')
    await createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('draft-only') })
    const entries = await listPublisherSitemapEntries()
    expect(entries).toEqual([{ path: shown.path, lastModified: shown.updatedAt, type: 'bulletin' }])
  })
})
