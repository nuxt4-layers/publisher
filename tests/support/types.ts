import { z } from 'zod'
import {
  assetIdSchema,
  definePublisherDocumentType,
  identifierSchema,
  markdownSchema,
  publisherConsentSchema,
  safeTextSchema,
} from '../../shared/contracts'

/**
 * Document types defined only for the tests. The layer knows none of them:
 * they prove that any type is a registration, never a change to the layer.
 */

/** Page-like: blocks, Markdown, an address at the site's root, review before publishing. */
export const landingType = definePublisherDocumentType({
  type: 'landing',
  label: { one: 'Landing', many: 'Landings' },
  fields: z.strictObject({
    intro: markdownSchema({ max: 10_000 }),
    section: z.enum(['products', 'company', 'support']),
    blocks: z.array(z.discriminatedUnion('block', [
      z.strictObject({ block: z.literal('prose'), body: markdownSchema({ max: 10_000 }) }),
      z.strictObject({ block: z.literal('figure'), assetId: assetIdSchema, alt: safeTextSchema({ max: 250 }) }),
    ])).max(20),
  }),
  markdownFields: ['intro', 'blocks[].body'],
  address: { kind: 'path', base: '', pattern: 'slug' },
  listing: { listable: true, order: 'title-asc', filterable: ['section'] },
  lifecycle: { approval: true, moderation: false, scheduling: true, risks: { publish: 'high' } },
})

/** Review-like: a person's rating and words, moderated, consent recorded, no address of its own. */
export const appraisalType = definePublisherDocumentType({
  type: 'appraisal',
  label: { one: 'Appraisal', many: 'Appraisals' },
  fields: z.strictObject({
    authorId: identifierSchema,
    consent: publisherConsentSchema.optional(),
    stars: z.number().int().min(1).max(5),
    words: markdownSchema({ max: 2000 }),
  }),
  markdownFields: ['words'],
  address: { kind: 'none' },
  listing: { listable: true, order: 'published-desc', filterable: [] },
  lifecycle: { approval: false, moderation: true, scheduling: false },
  personalData: { subjectField: 'authorId', consentField: 'consent', retentionDays: 90 },
})

/** Dated and listed under a base, with scheduling and no review. */
export const bulletinType = definePublisherDocumentType({
  type: 'bulletin',
  label: { one: 'Bulletin', many: 'Bulletins' },
  fields: z.strictObject({
    body: markdownSchema({ max: 10_000 }),
    topic: z.string().max(40).regex(/^[a-z-]+$/),
  }),
  markdownFields: ['body'],
  address: { kind: 'path', base: '/bulletins', pattern: 'date-slug' },
  listing: { listable: true, order: 'published-desc', filterable: ['topic'] },
  lifecycle: { approval: false, moderation: false, scheduling: true },
})

export const TEST_TYPES = [landingType, appraisalType, bulletinType] as const

/** Content for a landing. */
export function landing(slug: string, title = 'Landing', intro = 'Welcome.') {
  return { locale: 'en-GB', title, summary: `${title} summary`, slug, fields: { intro, section: 'products', blocks: [{ block: 'prose', body: 'More.' }] } }
}

/** Content for an appraisal by a person, with or without recorded consent. */
export function appraisal(authorId: string, options: { consent?: boolean, stars?: number, words?: string } = {}) {
  return {
    locale: 'en-GB',
    title: 'An appraisal',
    fields: {
      authorId,
      stars: options.stars ?? 5,
      words: options.words ?? 'Splendid.',
      ...(options.consent === false ? {} : { consent: { givenAt: '2026-10-20T12:00:00.000Z', statement: 'appraisal-v1' } }),
    },
  }
}

/** Content for a bulletin. */
export function bulletin(slug: string, title = 'Bulletin', topic = 'general', addressDate: string | null = '2026-10-21') {
  return { locale: 'en-GB', title, slug, addressDate, fields: { body: 'News.', topic } }
}
