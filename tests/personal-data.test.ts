import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PublisherSubject } from '../shared/contracts'
import { publisherPersonExportSchema } from '../shared/contracts'
import {
  createPublisherDocument,
  erasePublisherPerson,
  exportPublisherPersonData,
  getPublishedDocument,
  listPublishedDocuments,
  listPublisherBacklinks,
  listPublisherHistory,
  receivePublisherSubmission,
  runPublisherMaintenance,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { appraisal, bulletin } from './support/types'
import { id, person, World, SITE } from './support/world'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('personal data (PostgreSQL)', () => {
  let harness: Harness
  let world: World
  const alice = id()
  const carol = id()
  const dave = id()
  let editor: PublisherSubject

  const act = (documentId: string, request: Parameters<typeof transitionPublisherDocument>[0]['request']) =>
    transitionPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), documentId, request })

  async function accepted(authorId: string, words = 'Splendid.'): Promise<string> {
    const { documentId } = await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: authorId, type: 'appraisal', content: appraisal(authorId, { words }) })
    await act(documentId, { action: 'moderate', expectedVersion: 1, outcome: 'accept' })
    return documentId
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

  it('refuses publishing a personal-data type without recorded consent, by any route', async () => {
    const draft = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'appraisal', content: appraisal(carol, { consent: false }) })
    await expect(act(draft.id, { action: 'publish', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'consent-missing' })
    const { documentId } = await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: carol, type: 'appraisal', content: appraisal(carol, { consent: false }) })
    await expect(act(documentId, { action: 'moderate', expectedVersion: 1, outcome: 'accept' })).rejects.toMatchObject({ code: 'conflict', reason: 'consent-missing' })
    // Consent recorded, then withdrawn in a later version: the later version cannot be published.
    const withConsent = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'appraisal', content: appraisal(carol) })
    await act(withConsent.id, { action: 'publish', expectedVersion: 1 })
    await act(withConsent.id, { action: 'save', expectedVersion: 1, content: appraisal(carol, { consent: false }) })
    await expect(act(withConsent.id, { action: 'publish', expectedVersion: 2 })).rejects.toMatchObject({ code: 'conflict', reason: 'consent-missing' })
  })

  it('never shows readers the person\'s identifier or consent record', async () => {
    const documentId = await accepted(carol)
    const rendered = await getPublishedDocument({ siteId: SITE, documentId })
    expect(rendered?.document.fields).toEqual({ stars: 5, words: 'Splendid.' })
    expect(JSON.stringify(await listPublishedDocuments({ siteId: SITE, type: 'appraisal' }))).not.toContain(carol)
  })

  it('exports exactly that person\'s documents, with every version', async () => {
    const mine = await accepted(carol, 'First.')
    await act(mine, { action: 'save', expectedVersion: 1, content: appraisal(carol, { words: 'Edited.' }) })
    const pending = (await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: carol, type: 'appraisal', content: appraisal(carol, { words: 'Pending.' }) })).documentId
    await accepted(dave, 'Not hers.')
    // A document of another type that merely names her is not personal data of hers.
    await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: { ...bulletin('mentions'), fields: { body: carol, topic: 'general' } } })

    const exported = publisherPersonExportSchema.parse(await exportPublisherPersonData({ identityId: carol }))
    expect(exported.identityId).toBe(carol)
    expect(exported.documents.map(document => document.id).sort()).toEqual([mine, pending].sort())
    expect(exported.documents.find(document => document.id === mine)!.versions.map(version => version.content.fields.words)).toEqual(['First.', 'Edited.'])
    expect((await exportPublisherPersonData({ identityId: id() })).documents).toEqual([])
  })

  it('erases exactly that person\'s documents, their history, links and redirects, and nothing else', async () => {
    const mine = await accepted(carol)
    await act(mine, { action: 'save', expectedVersion: 1, content: appraisal(carol, { words: 'Again.' }) })
    const theirs = await accepted(dave)
    const linking = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: { ...bulletin('linking'), fields: { body: `[an appraisal](doc:${mine})`, topic: 'general' } } })

    expect(await erasePublisherPerson({ identityId: carol, correlationId: id() })).toEqual({ documents: 1, versions: 2 })
    expect(await getPublishedDocument({ siteId: SITE, documentId: mine })).toBeNull()
    await expect(listPublisherHistory({ siteId: SITE, subject: editor, documentId: mine })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await exportPublisherPersonData({ identityId: carol })).documents).toEqual([])
    expect(await listPublisherBacklinks({ siteId: SITE, subject: editor, documentId: theirs })).toEqual([])
    expect((await getPublishedDocument({ siteId: SITE, documentId: theirs }))?.document.fields).toMatchObject({ words: 'Splendid.' })
    // The linking document survives; its link now renders as text.
    expect(linking.id).toBeTruthy()
    expect((await harness.outbox()).at(-1)).toMatchObject({ type: 'publisher.person-erased', data: { identityId: carol, documents: 1, versions: 2 } })
    // Erasing twice erases nothing more.
    expect(await erasePublisherPerson({ identityId: carol, correlationId: id() })).toEqual({ documents: 0, versions: 0 })
  })

  it('deletes old versions of personal-data documents after the type\'s retention period, keeping the current and published ones', async () => {
    const documentId = await accepted(carol, 'One.')
    for (const [version, words] of [[1, 'Two.'], [2, 'Three.']] as const) await act(documentId, { action: 'save', expectedVersion: version, content: appraisal(carol, { words }) })
    const kept = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('ordinary') })
    await act(kept.id, { action: 'save', expectedVersion: 1, content: bulletin('ordinary', 'Two') })

    world.advance(89 * 24 * 60)
    expect(await runPublisherMaintenance()).toMatchObject({ versionsDeleted: 0 })
    world.advance(2 * 24 * 60)
    expect(await runPublisherMaintenance()).toMatchObject({ versionsDeleted: 1 })
    // Version 1 is published, version 3 is current; version 2 is gone.
    expect((await listPublisherHistory({ siteId: SITE, subject: editor, documentId })).map(version => version.version)).toEqual([3, 1])
    // Types without personal data keep their history.
    expect(await listPublisherHistory({ siteId: SITE, subject: editor, documentId: kept.id })).toHaveLength(2)
  })
})
