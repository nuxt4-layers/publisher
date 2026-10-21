import { richTextSchema } from '@nuxt4-layers/rich-text'
import { z } from 'zod'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PublisherActionRequestInput, PublisherDocument, PublisherSubject } from '../shared/contracts'
import { definePublisherDocumentType, PUBLISHER_ACTIONS, PUBLISHER_TRANSITIONS } from '../shared/contracts'
import { providePublisherDocumentTypes } from '../server/utils/publisher-composition'
import {
  createPublisherDocument,
  exportPublisherContent,
  getPublishedDocument,
  getPublisherDocument,
  getPublisherFeed,
  listPublishedDocuments,
  listPublisherHistory,
  listPublisherModerationQueue,
  receivePublisherSubmission,
  resolvePublisherPath,
  runPublisherMaintenance,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { appraisal, bulletin, landing, TEST_TYPES } from './support/types'
import { id, person, World, SITE } from './support/world'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('the lifecycle (PostgreSQL)', () => {
  let harness: Harness
  let world: World
  const alice = id()
  const bob = id()
  const carol = id()
  let editor: PublisherSubject
  let approver: PublisherSubject
  let reader: PublisherSubject

  const act = (subject: PublisherSubject, document: PublisherDocument | string, request: PublisherActionRequestInput) =>
    transitionPublisherDocument({ siteId: SITE, subject, correlationId: id(), documentId: typeof document === 'string' ? document : document.id, request })

  const create = (subject: PublisherSubject, type: string, content: unknown) =>
    createPublisherDocument({ siteId: SITE, subject, correlationId: id(), type, content: content as never })

  /** Creates, reviews where the type needs it, and publishes. */
  async function published(type: 'landing' | 'bulletin', content: unknown): Promise<PublisherDocument> {
    let document = await create(editor, type, content)
    if (type === 'landing') {
      document = await act(editor, document, { action: 'submit', expectedVersion: document.version })
      world.approve(world.approvalFor(document.id)!, bob)
    }
    return act(editor, document, { action: 'publish', expectedVersion: document.version })
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
    world.grant(bob, 'publisher.landing.view-draft')
    editor = person(alice, world.time)
    approver = person(bob, world.time)
    reader = person(carol, world.time)
  })

  describe('generality', () => {
    it('stores, versions, reviews, publishes, lists, feeds and exports two unrelated types with the same code', async () => {
      // A page-like type: blocks, an address, review by the approval port.
      let page = await create(editor, 'landing', landing('about', 'About us'))
      page = await act(editor, page, { action: 'save', expectedVersion: 1, content: landing('about', 'About us', 'Hello again.') })
      expect(page.version).toBe(2)
      page = await act(editor, page, { action: 'submit', expectedVersion: 2 })
      expect(page.status).toBe('in-review')
      world.approve(world.approvalFor(page.id)!, bob)
      page = await act(editor, page, { action: 'publish', expectedVersion: 2 })
      expect(page).toMatchObject({ status: 'published', publishedVersion: 2, path: '/about' })

      // A review-like type: a person's rating, moderated, consent recorded.
      const { documentId } = await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: carol, type: 'appraisal', content: appraisal(carol) })
      let rating = await act(editor, documentId, { action: 'moderate', expectedVersion: 1, outcome: 'accept' })
      expect(rating).toMatchObject({ status: 'published', moderation: 'accepted', path: null })
      rating = await act(editor, rating, { action: 'save', expectedVersion: 1, content: appraisal(carol, { stars: 4 }) })
      expect((await listPublisherHistory({ siteId: SITE, subject: editor, documentId })).map(version => version.version)).toEqual([2, 1])

      expect((await listPublishedDocuments({ siteId: SITE, type: 'landing' })).documents.map(document => document.id)).toEqual([page.id])
      expect((await listPublishedDocuments({ siteId: SITE, type: 'appraisal' })).documents.map(document => document.id)).toEqual([documentId])
      expect(await getPublisherFeed({ siteId: SITE, type: 'landing', format: 'atom', origin: 'https://example.test' })).toContain('https://example.test/about')
      expect(await getPublisherFeed({ siteId: SITE, type: 'appraisal', format: 'rss', origin: 'https://example.test' })).toContain(`urn:uuid:${documentId}`)
      const bundle = await exportPublisherContent({ siteId: SITE })
      expect(bundle.documents.map(document => document.type).sort()).toEqual(['appraisal', 'landing'])
    })

    it('takes a third type with a registration and no other change', async () => {
      const recipeType = definePublisherDocumentType({
        type: 'recipe',
        label: { one: 'Recipe', many: 'Recipes' },
        fields: z.strictObject({ method: richTextSchema({ profile: 'block', max: 5000 }), serves: z.number().int().min(1).max(20) }),
        address: { kind: 'path', base: '/recipes', pattern: 'slug' },
        listing: { listable: true, order: 'title-asc', filterable: [] },
      })
      providePublisherDocumentTypes([...TEST_TYPES, recipeType])
      world.grantAll(alice, 'recipe')
      let recipe = await create(editor, 'recipe', { locale: 'en-GB', title: 'Scones', slug: 'scones', fields: { method: 'Mix, then **bake**.', serves: 6 } })
      recipe = await act(editor, recipe, { action: 'publish', expectedVersion: 1 })
      expect((await getPublishedDocument({ siteId: SITE, path: '/recipes/scones' }))?.document.fields).toEqual({ method: 'Mix, then **bake**.', serves: 6 })
      expect((await listPublishedDocuments({ siteId: SITE, type: 'recipe' })).total).toBe(1)
      expect(await getPublisherFeed({ siteId: SITE, type: 'recipe', format: 'rss', origin: 'https://example.test' })).toContain('Scones')
      expect((await exportPublisherContent({ siteId: SITE, types: ['recipe'] })).documents).toHaveLength(1)
      // Its fields are checked against its own schema.
      await expect(create(editor, 'recipe', { locale: 'en-GB', title: 'Bad', slug: 'bad', fields: { method: 'x', serves: 0 } })).rejects.toMatchObject({ code: 'validation-failed' })
    })
  })

  describe('visibility', () => {
    it('makes only published documents public; a draft answers exactly as a missing document', async () => {
      const draft = await create(editor, 'bulletin', bulletin('draft'))
      const missing = { path: '/bulletins/2026/10/21/nothing-here' }
      for (const viewer of [null, reader, approver]) {
        expect(await getPublishedDocument({ siteId: SITE, path: '/bulletins/2026/10/21/draft', viewer })).toBeNull()
        expect(await getPublishedDocument({ siteId: SITE, path: '/bulletins/2026/10/21/draft', viewer, preview: true })).toBeNull()
        expect(await getPublishedDocument({ siteId: SITE, documentId: draft.id, viewer, preview: true })).toBeNull()
        expect(await resolvePublisherPath({ siteId: SITE, path: '/bulletins/2026/10/21/draft', viewer, preview: true })).toEqual(await resolvePublisherPath({ siteId: SITE, ...missing, viewer, preview: true }))
      }
      expect((await listPublishedDocuments({ siteId: SITE, type: 'bulletin' })).total).toBe(0)
      // With `view-draft`, a preview of the newest version.
      const preview = await getPublishedDocument({ siteId: SITE, documentId: draft.id, viewer: editor, preview: true })
      expect(preview).toMatchObject({ preview: true, document: { status: 'draft', version: 1 } })
    })

    it('serves the published version of a published document while a newer one is drafted', async () => {
      let document = await published('bulletin', bulletin('news', 'First'))
      document = await act(editor, document, { action: 'save', expectedVersion: 1, content: bulletin('news', 'Second') })
      expect(document).toMatchObject({ status: 'published', latestVersion: 2, publishedVersion: 1 })
      expect((await getPublishedDocument({ siteId: SITE, path: '/bulletins/2026/10/21/news' }))?.document.title).toBe('First')
      expect((await getPublishedDocument({ siteId: SITE, path: '/bulletins/2026/10/21/news', viewer: editor, preview: true }))?.document.title).toBe('Second')
      await act(editor, document, { action: 'publish', expectedVersion: 2 })
      expect((await getPublishedDocument({ siteId: SITE, path: '/bulletins/2026/10/21/news' }))?.document.title).toBe('Second')
    })

    it('hides archived and unpublished documents again', async () => {
      const document = await published('bulletin', bulletin('gone'))
      const unpublished = await act(editor, document, { action: 'unpublish', expectedVersion: 1, acknowledgedLinks: 0 })
      expect(unpublished.status).toBe('draft')
      expect(await getPublishedDocument({ siteId: SITE, documentId: document.id })).toBeNull()
      await act(editor, unpublished, { action: 'archive', expectedVersion: 1, acknowledgedLinks: 0 })
      expect(await getPublishedDocument({ siteId: SITE, documentId: document.id, viewer: editor })).toBeNull()
    })
  })

  describe('permissions and assurance', () => {
    it('refuses each action without its permission', async () => {
      const mallory = id()
      const subject = person(mallory, world.time)
      await expect(create(subject, 'bulletin', bulletin('x'))).rejects.toMatchObject({ code: 'forbidden' })
      const document = await create(editor, 'bulletin', bulletin('x'))
      const requests: Record<string, PublisherActionRequestInput> = {
        save: { action: 'save', expectedVersion: 1, content: bulletin('x', 'Changed') },
        publish: { action: 'publish', expectedVersion: 1 },
        archive: { action: 'archive', expectedVersion: 1, acknowledgedLinks: 0 },
        restore: { action: 'restore', expectedVersion: 1, version: 1 },
      }
      for (const [action, request] of Object.entries(requests)) {
        world.grant(mallory, 'publisher.bulletin.view-draft')
        await expect(act(subject, document, request), action).rejects.toMatchObject({ code: 'forbidden' })
        // Another type's permission is no help.
        world.grant(mallory, `publisher.landing.${PUBLISHER_TRANSITIONS[request.action].permission}`)
        await expect(act(subject, document, request), action).rejects.toMatchObject({ code: 'forbidden' })
      }
      await expect(getPublisherDocument({ siteId: SITE, subject: person(id(), world.time), documentId: document.id })).rejects.toMatchObject({ code: 'forbidden' })
      expect(PUBLISHER_ACTIONS.every(action => PUBLISHER_TRANSITIONS[action].permission)).toBe(true)
    })

    it('refuses moderation without `moderate`, even to whoever may publish', async () => {
      const { documentId } = await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: null, type: 'appraisal', content: appraisal(carol) })
      world.revoke(alice, 'publisher.appraisal.moderate')
      await expect(act(editor, documentId, { action: 'moderate', expectedVersion: 1, outcome: 'accept' })).rejects.toMatchObject({ code: 'forbidden' })
    })

    it('refuses publishing below the assurance the publish permission\'s risk needs', async () => {
      let document = await create(editor, 'landing', landing('secure'))
      document = await act(editor, document, { action: 'submit', expectedVersion: 1 })
      world.approve(world.approvalFor(document.id)!, bob)
      await expect(act(person(alice, world.time, 'weak'), document, { action: 'publish', expectedVersion: 1 })).rejects.toMatchObject({ code: 'insufficient-assurance' })
      await expect(act(editor, document, { action: 'publish', expectedVersion: 1 })).resolves.toMatchObject({ status: 'published' })
    })
  })

  describe('review and approval', () => {
    it('never publishes a type needing review without the approval port\'s consent to that version', async () => {
      let document = await create(editor, 'landing', landing('reviewed'))
      await expect(act(editor, document, { action: 'publish', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'review-required' })
      document = await act(editor, document, { action: 'submit', expectedVersion: 1 })
      const first = world.approvalFor(document.id)!
      expect(world.approvals.get(first)!.input).toMatchObject({ documentId: document.id, version: 1, risk: 'high', requiredApprovals: 1, requesterId: alice, permission: 'publisher.landing.publish' })
      // Pending, rejected, approved only by the requester: no consent.
      await expect(act(editor, document, { action: 'publish', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'approval-missing' })
      world.approve(first, alice)
      await expect(act(editor, document, { action: 'publish', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'approval-missing' })
      // Saving after approval asks again: the consent was to the old version.
      world.approve(first, bob)
      document = await act(editor, document, { action: 'save', expectedVersion: 1, content: landing('reviewed', 'Changed after approval') })
      expect(document.status).toBe('draft')
      document = await act(editor, document, { action: 'submit', expectedVersion: 2 })
      await expect(act(editor, document, { action: 'publish', expectedVersion: 2 })).rejects.toMatchObject({ code: 'conflict', reason: 'approval-missing' })
      world.reject(world.approvalFor(document.id)!)
      await expect(act(editor, document, { action: 'publish', expectedVersion: 2 })).rejects.toMatchObject({ code: 'conflict', reason: 'approval-missing' })
      document = await act(editor, document, { action: 'withdraw', expectedVersion: 2 })
      document = await act(editor, document, { action: 'submit', expectedVersion: 2 })
      world.approve(world.approvalFor(document.id)!, bob)
      await expect(act(editor, document, { action: 'publish', expectedVersion: 2 })).resolves.toMatchObject({ status: 'published', publishedVersion: 2 })
    })

    it('reviews a newer version of a published document while the published one stays live', async () => {
      let document = await published('landing', landing('live', 'Live'))
      document = await act(editor, document, { action: 'save', expectedVersion: 1, content: landing('live', 'Next') })
      document = await act(editor, document, { action: 'submit', expectedVersion: 2 })
      expect(document).toMatchObject({ status: 'published', publishedVersion: 1, reviewVersion: 2 })
      await expect(act(editor, document, { action: 'publish', expectedVersion: 2 })).rejects.toMatchObject({ reason: 'approval-missing' })
      world.approve(world.approvalFor(document.id)!, bob)
      await act(editor, document, { action: 'publish', expectedVersion: 2 })
      expect((await getPublishedDocument({ siteId: SITE, path: '/live' }))?.document.title).toBe('Next')
    })

    it('publishes a type without review at once', async () => {
      const document = await create(editor, 'bulletin', bulletin('plain'))
      await expect(act(editor, document, { action: 'submit', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'invalid-transition' })
      await expect(act(editor, document, { action: 'publish', expectedVersion: 1 })).resolves.toMatchObject({ status: 'published' })
      expect(world.approvals.size).toBe(0)
    })
  })

  describe('moderation', () => {
    it('keeps submissions hidden until a moderator accepts them, and hidden for good when rejected', async () => {
      const accepted = await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: carol, type: 'appraisal', content: appraisal(carol) })
      const rejected = await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: null, type: 'appraisal', content: appraisal(id(), { words: 'Spam' }) })
      for (const { documentId } of [accepted, rejected]) {
        expect(await getPublishedDocument({ siteId: SITE, documentId })).toBeNull()
        expect(await getPublisherDocument({ siteId: SITE, subject: editor, documentId })).toMatchObject({ status: 'in-review', moderation: 'pending' })
      }
      expect((await listPublishedDocuments({ siteId: SITE, type: 'appraisal' })).total).toBe(0)
      expect((await listPublisherModerationQueue({ siteId: SITE, subject: editor })).documents.map(document => document.id).sort()).toEqual([accepted.documentId, rejected.documentId].sort())
      // A moderated submission is not published by `publish`: it waits for a moderator.
      await expect(act(editor, accepted.documentId, { action: 'publish', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'not-moderated' })

      await act(editor, accepted.documentId, { action: 'moderate', expectedVersion: 1, outcome: 'accept' })
      await act(editor, rejected.documentId, { action: 'moderate', expectedVersion: 1, outcome: 'reject' })
      expect((await listPublishedDocuments({ siteId: SITE, type: 'appraisal' })).documents.map(document => document.id)).toEqual([accepted.documentId])
      expect(await getPublisherDocument({ siteId: SITE, subject: editor, documentId: rejected.documentId })).toMatchObject({ status: 'archived', moderation: 'rejected' })
      expect((await listPublisherModerationQueue({ siteId: SITE, subject: editor })).total).toBe(0)
      // Only moderated types take submissions.
      await expect(receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: carol, type: 'bulletin', content: bulletin('x') })).rejects.toMatchObject({ code: 'validation-failed' })
    })

    it('lists the queue only to moderators', async () => {
      await receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: carol, type: 'appraisal', content: appraisal(carol) })
      expect((await listPublisherModerationQueue({ siteId: SITE, subject: reader })).total).toBe(0)
    })
  })

  describe('scheduling', () => {
    it('publishes and unpublishes when the clock passes the times, and not before', async () => {
      const start = world.time
      const publishAt = new Date(start.getTime() + 60 * 60_000).toISOString()
      const unpublishAt = new Date(start.getTime() + 120 * 60_000).toISOString()
      let document = await create(editor, 'bulletin', bulletin('later'))
      document = await act(editor, document, { action: 'publish', expectedVersion: 1, publishAt, unpublishAt })
      expect(document).toMatchObject({ status: 'scheduled', publishAt, unpublishAt })

      world.advance(59)
      expect(await runPublisherMaintenance()).toMatchObject({ published: 0, unpublished: 0 })
      expect(await getPublishedDocument({ siteId: SITE, documentId: document.id })).toBeNull()
      world.advance(1)
      expect(await runPublisherMaintenance()).toMatchObject({ published: 1 })
      expect((await getPublishedDocument({ siteId: SITE, documentId: document.id }))?.document.status).toBe('published')
      expect(await runPublisherMaintenance()).toMatchObject({ published: 0 })

      world.advance(59)
      await runPublisherMaintenance()
      expect(await getPublishedDocument({ siteId: SITE, documentId: document.id })).not.toBeNull()
      world.advance(1)
      expect(await runPublisherMaintenance()).toMatchObject({ unpublished: 1 })
      expect(await getPublishedDocument({ siteId: SITE, documentId: document.id })).toBeNull()
      expect((await getPublisherDocument({ siteId: SITE, subject: editor, documentId: document.id })).status).toBe('archived')
    })

    it('refuses scheduling for a type that does not allow it, and times out of order', async () => {
      const document = await create(editor, 'appraisal', appraisal(carol))
      const later = new Date(world.time.getTime() + 60_000).toISOString()
      await expect(act(editor, document, { action: 'publish', expectedVersion: 1, publishAt: later })).rejects.toMatchObject({ code: 'conflict', reason: 'scheduling-disabled' })
      const other = await create(editor, 'bulletin', bulletin('order'))
      await expect(act(editor, other, { action: 'publish', expectedVersion: 1, publishAt: later, unpublishAt: world.time.toISOString() })).rejects.toMatchObject({ code: 'validation-failed' })
    })

    it('withdraws a scheduled document back to draft', async () => {
      let document = await create(editor, 'bulletin', bulletin('withdrawn'))
      document = await act(editor, document, { action: 'publish', expectedVersion: 1, publishAt: new Date(world.time.getTime() + 60_000).toISOString() })
      document = await act(editor, document, { action: 'withdraw', expectedVersion: 1 })
      expect(document).toMatchObject({ status: 'draft', publishAt: null })
      world.advance(5)
      expect(await runPublisherMaintenance()).toMatchObject({ published: 0 })
    })
  })

  describe('versions', () => {
    it('refuses a stale version', async () => {
      const document = await create(editor, 'bulletin', bulletin('locked'))
      await act(editor, document, { action: 'save', expectedVersion: 1, content: bulletin('locked', 'Mine') })
      await expect(act(editor, document, { action: 'save', expectedVersion: 1, content: bulletin('locked', 'Theirs') })).rejects.toMatchObject({ code: 'conflict', reason: 'version-stale' })
      await expect(act(editor, document, { action: 'publish', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'version-stale' })
    })

    it('keeps every version, and restores an earlier one as a new version', async () => {
      let document = await create(editor, 'bulletin', bulletin('kept', 'One'))
      document = await act(editor, document, { action: 'save', expectedVersion: 1, content: bulletin('kept', 'Two') })
      document = await act(editor, document, { action: 'save', expectedVersion: 2, content: bulletin('kept', 'Three') })
      const history = await listPublisherHistory({ siteId: SITE, subject: editor, documentId: document.id })
      expect(history.map(version => version.version)).toEqual([3, 2, 1])
      expect(new Set(history.map(version => version.digest)).size).toBe(3)
      expect((await getPublisherDocument({ siteId: SITE, subject: editor, documentId: document.id, version: 1 })).title).toBe('One')

      document = await act(editor, document, { action: 'restore', expectedVersion: 3, version: 1 })
      expect(document).toMatchObject({ version: 4, title: 'One' })
      expect((await listPublisherHistory({ siteId: SITE, subject: editor, documentId: document.id }))[0]).toMatchObject({ version: 4, restoredFrom: 1, savedBy: alice })
      await expect(act(editor, document, { action: 'restore', expectedVersion: 4, version: 9 })).rejects.toMatchObject({ code: 'validation-failed' })
    })

    it('refuses actions that the state machine does not allow from the current status', async () => {
      const document = await published('bulletin', bulletin('state'))
      await expect(act(editor, document, { action: 'withdraw', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'invalid-transition' })
      await expect(act(editor, document, { action: 'reopen', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', reason: 'invalid-transition' })
      const archived = await act(editor, document, { action: 'archive', expectedVersion: 1, acknowledgedLinks: 0 })
      await expect(act(editor, archived, { action: 'save', expectedVersion: 1, content: bulletin('state') })).rejects.toMatchObject({ code: 'conflict', reason: 'invalid-transition' })
      await expect(act(editor, archived, { action: 'reopen', expectedVersion: 1 })).resolves.toMatchObject({ status: 'draft' })
    })
  })
})
