import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PublisherSubject } from '../shared/contracts'
import { providePublisherTitleTemplate } from '../server/utils/publisher-composition'
import {
  createPublisherDocument,
  getPublishedDocument,
  getPublisherFeed,
  listPublishedDocuments,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { bulletin } from './support/types'
import { id, person, World, SITE } from './support/world'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('reading: listings, feeds and metadata (PostgreSQL)', () => {
  let harness: Harness
  let world: World
  const alice = id()
  let editor: PublisherSubject

  async function publish(slug: string, title: string, topic: string, minutesLater: number) {
    world.advance(minutesLater)
    const document = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: bulletin(slug, title, topic) })
    return transitionPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), documentId: document.id, request: { action: 'publish', expectedVersion: 1 } })
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

  it('lists a type\'s published documents by its default order, with filters and paging', async () => {
    await publish('alpha', 'Alpha', 'sport', 1)
    await publish('bravo', 'Bravo', 'weather', 1)
    await publish('charlie', 'Charlie', 'sport', 1)
    await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('draft', 'Draft', 'sport') })

    const all = await listPublishedDocuments({ siteId: SITE, type: 'bulletin' })
    expect(all.total).toBe(3)
    expect(all.documents.map(document => document.title)).toEqual(['Charlie', 'Bravo', 'Alpha'])
    expect((await listPublishedDocuments({ siteId: SITE, type: 'bulletin', order: 'title-asc' })).documents.map(document => document.title)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    const sport = await listPublishedDocuments({ siteId: SITE, type: 'bulletin', filters: { topic: 'sport' } })
    expect(sport.documents.map(document => document.title)).toEqual(['Charlie', 'Alpha'])
    const second = await listPublishedDocuments({ siteId: SITE, type: 'bulletin', limit: 1, offset: 1 })
    expect(second).toMatchObject({ total: 3, documents: [expect.objectContaining({ title: 'Bravo' })] })
  })

  it('refuses a filter the type does not declare, and listing a type that is not listable', async () => {
    await expect(listPublishedDocuments({ siteId: SITE, type: 'bulletin', filters: { body: 'x' } })).rejects.toMatchObject({ code: 'validation-failed', reason: 'unknown-filter' })
    await expect(listPublishedDocuments({ siteId: SITE, type: 'recipe' })).rejects.toMatchObject({ code: 'validation-failed', reason: 'unknown-type' })
  })

  it('writes RSS and Atom feeds with absolute addresses, escaping every title', async () => {
    await publish('escaped', 'Fish & <Chips>', 'food', 1)
    const rss = await getPublisherFeed({ siteId: SITE, type: 'bulletin', format: 'rss', origin: 'https://example.test' })
    expect(rss).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\s*<rss version="2.0"/)
    expect(rss).toContain('<link>https://example.test/bulletins/2026/10/21/escaped</link>')
    expect(rss).toContain('Fish &amp; &lt;Chips&gt;')
    expect(rss).not.toContain('<Chips>')
    const atom = await getPublisherFeed({ siteId: SITE, type: 'bulletin', format: 'atom', origin: 'https://example.test' })
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(atom).toContain('href="https://example.test/bulletins/2026/10/21/escaped"')
    // The feed's own title goes through the host's title template.
    expect(atom).toContain('<title>Bulletins · Test site</title>')
    await expect(getPublisherFeed({ siteId: SITE, type: 'bulletin', format: 'rss', origin: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'validation-failed' })
  })

  it('answers the metadata the public route sets, through the title template when there is one', async () => {
    const document = await publish('meta', 'Meta', 'general', 1)
    const rendered = await getPublishedDocument({ siteId: SITE, documentId: document.id })
    expect(rendered?.head).toEqual({
      title: 'Meta · Test site',
      description: null,
      canonicalPath: '/bulletins/2026/10/21/meta',
      locale: 'en-GB',
      publishedAt: document.publishedAt,
      modifiedAt: document.updatedAt,
    })
    providePublisherTitleTemplate({ format: ({ title, type }) => `${title} (${type})` })
    expect((await getPublishedDocument({ siteId: SITE, documentId: document.id }))?.head.title).toBe('Meta (bulletin)')
  })
})
