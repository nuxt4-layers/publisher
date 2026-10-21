import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PublisherBundle } from '../shared/contracts'
import { publisherBundleSchema } from '../shared/contracts'
import { clearPublisherComposition, providePublisherDatabase, providePublisherDocumentTypes } from '../server/utils/publisher-composition'
import {
  createPublisherDocument,
  exportPublisherContent,
  getPublishedDocument,
  importPublisherContent,
  migratePublisherDatabase,
  receivePublisherSubmission,
  resolvePublisherPath,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { createTestDatabase, hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { appraisal, bulletin, landing, TEST_TYPES } from './support/types'
import { id, person, SITE } from './support/world'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('export and import (PostgreSQL)', () => {
  let harness: Harness
  let exported: PublisherBundle
  let empty: { pool: pg.Pool, drop: () => Promise<void> }

  beforeAll(async () => {
    harness = await Harness.open()
    const world = await harness.reset()
    const alice = id()
    for (const type of ['landing', 'appraisal', 'bulletin']) world.grantAll(alice, type)
    const editor = person(alice, world.time)
    const act = (documentId: string, request: Parameters<typeof transitionPublisherDocument>[0]['request']) =>
      transitionPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), documentId, request })

    // Several versions, a rename with its redirect, a link, a draft, a moderated submission and a schedule.
    const target = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('target') })
    await act(target.id, { action: 'publish', expectedVersion: 1 })
    await act(target.id, { action: 'save', expectedVersion: 1, content: bulletin('target-renamed', 'Renamed') })
    await act(target.id, { action: 'publish', expectedVersion: 2 })
    const page = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'landing', content: landing('welcome', 'Welcome', `See [the bulletin](doc:${target.id}).`) })
    await act(page.id, { action: 'submit', expectedVersion: 1 })
    world.approve(world.approvalFor(page.id)!, id())
    await act(page.id, { action: 'publish', expectedVersion: 1 })
    await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('draft', 'Just a draft') })
    const scheduled = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('soon') })
    await act(scheduled.id, { action: 'publish', expectedVersion: 1, publishAt: new Date(world.time.getTime() + 3_600_000).toISOString() })
    const { documentId } = await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: alice, type: 'appraisal', content: appraisal(alice) })
    await act(documentId, { action: 'moderate', expectedVersion: 1, outcome: 'accept' })

    exported = await exportPublisherContent({ siteId: SITE })
    const database = await createTestDatabase()
    empty = { pool: new pg.Pool({ connectionString: database.url }), drop: database.drop }
  })

  afterAll(async () => {
    clearPublisherComposition()
    await empty?.pool.end()
    await empty?.drop()
    await harness?.close()
  })

  it('exports a valid bundle of every document, every version and every redirect', () => {
    expect(publisherBundleSchema.parse(exported).documents).toHaveLength(5)
    const target = exported.documents.find(document => document.versions.some(version => version.content.slug === 'target-renamed'))!
    expect(target.versions.map(version => version.version)).toEqual([1, 2])
    expect(target.redirects).toEqual(['/bulletins/2026/10/21/target'])
  })

  it('exports by type', async () => {
    providePublisherDatabase({ dialect: 'postgres', pool: harness.pool })
    const landings = await exportPublisherContent({ siteId: SITE, types: ['landing'] })
    expect(landings.types).toEqual(['landing'])
    expect(landings.documents.map(document => document.type)).toEqual(['landing'])
  })

  it('imports into an empty database to give identical content', async () => {
    clearPublisherComposition()
    providePublisherDatabase({ dialect: 'postgres', pool: empty.pool })
    providePublisherDocumentTypes(TEST_TYPES)
    await migratePublisherDatabase()
    expect(await importPublisherContent({ siteId: SITE, bundle: exported, correlationId: id() })).toEqual({ documents: 5, versions: 6 })
    const again = await exportPublisherContent({ siteId: SITE })
    expect({ ...again, exportedAt: null }).toEqual({ ...exported, exportedAt: null })
    // And it serves the same: the document, the redirect and the resolved link.
    const page = await getPublishedDocument({ siteId: SITE, path: '/welcome' })
    expect(Object.values(page!.links.documents)).toEqual(['/bulletins/2026/10/21/target-renamed'])
    expect(await resolvePublisherPath({ siteId: SITE, path: '/bulletins/2026/10/21/target' })).toMatchObject({ kind: 'redirect' })
  })

  it('refuses a second import of the same documents, a malformed bundle and an unregistered type, importing nothing', async () => {
    await expect(importPublisherContent({ siteId: SITE, bundle: exported, correlationId: id() })).rejects.toMatchObject({ code: 'conflict' })
    await expect(importPublisherContent({ siteId: SITE, bundle: { ...exported, format: 'something-else' }, correlationId: id() })).rejects.toMatchObject({ code: 'validation-failed' })
    const foreign = { ...exported, documents: [{ ...exported.documents[0]!, id: id(), type: 'recipe' }] }
    await expect(importPublisherContent({ siteId: SITE, bundle: foreign, correlationId: id() })).rejects.toMatchObject({ code: 'validation-failed', reason: 'unknown-type' })
    // Every version's content is checked against its type, as on save.
    const invalid = { ...exported, documents: [{ ...exported.documents[0]!, id: id(), versions: exported.documents[0]!.versions.map(version => ({ ...version, content: { ...version.content, fields: { nonsense: true } } })) }] }
    await expect(importPublisherContent({ siteId: SITE, bundle: invalid, correlationId: id() })).rejects.toMatchObject({ code: 'validation-failed' })
    expect((await exportPublisherContent({ siteId: SITE })).documents).toHaveLength(5)
  })
})
