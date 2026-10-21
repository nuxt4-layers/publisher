import { richTextSchema } from '@nuxt4-layers/rich-text'
import { z } from 'zod'
import {
  assetIdSchema,
  definePublisherDocumentType,
  httpsUrlSchema,
  identifierSchema,
  publisherConsentSchema,
  safeTextSchema,
  sitePathSchema,
} from '../shared/contracts'

/**
 * Reference declarations: EXAMPLES ONLY (`@nuxt4-layers/publisher/examples`).
 * The layer never registers them. A host copies what it needs into its own
 * registration, or writes its own; nothing in the layer depends on them.
 */

/** A small block vocabulary for page-like types. A host's own may differ entirely. */
export const exampleBlockSchema = z.discriminatedUnion('block', [
  z.strictObject({ block: z.literal('text'), body: richTextSchema({ profile: 'document', max: 20_000 }) }),
  z.strictObject({ block: z.literal('image'), assetId: assetIdSchema, alt: safeTextSchema({ max: 250 }), caption: safeTextSchema({ min: 0, max: 300 }).optional() }),
  z.strictObject({ block: z.literal('quote'), text: safeTextSchema({ max: 1000 }), source: safeTextSchema({ min: 0, max: 200 }).optional() }),
  z.strictObject({ block: z.literal('call-to-action'), label: safeTextSchema({ max: 60 }), href: z.union([httpsUrlSchema, sitePathSchema]) }),
])

/** Pages at the site's root: `/about`, `/about/team`. */
export const examplePageType = definePublisherDocumentType({
  type: 'page',
  label: { one: 'Page', many: 'Pages' },
  fields: z.strictObject({
    body: richTextSchema({ profile: 'document', max: 100_000 }),
    blocks: z.array(exampleBlockSchema).max(50).default([]),
  }),
  address: { kind: 'path', base: '', pattern: 'slug' },
  listing: { listable: false, order: 'title-asc', filterable: [] },
  lifecycle: { approval: true, moderation: false, scheduling: true, risks: { publish: 'high' } },
})

/** Blog posts under `/blog/{YYYY}/{MM}/{DD}/{slug}`, listed and fed, filterable by tag. */
export const exampleBlogPostType = definePublisherDocumentType({
  type: 'post',
  label: { one: 'Post', many: 'Posts' },
  fields: z.strictObject({
    body: richTextSchema({ profile: 'document', max: 100_000 }),
    tags: z.array(z.string().max(40).regex(/^[a-z0-9-]+$/)).max(10).default([]),
    image: z.strictObject({ assetId: assetIdSchema, alt: safeTextSchema({ max: 250 }) }).optional(),
  }),
  address: { kind: 'path', base: '/blog', pattern: 'date-slug' },
  listing: { listable: true, order: 'published-desc', filterable: ['tags'] },
  lifecycle: { approval: false, moderation: false, scheduling: true },
})

/** A navigation menu: never addressed, only embedded by the host's shell. */
export const exampleMenuType = definePublisherDocumentType({
  type: 'menu',
  label: { one: 'Menu', many: 'Menus' },
  fields: z.strictObject({
    items: z.array(z.strictObject({
      label: safeTextSchema({ max: 60 }),
      // `doc:` keeps the link when the target's address changes.
      target: z.union([z.string().regex(/^doc:[0-9a-f-]{36}$/), httpsUrlSchema, sitePathSchema]),
    })).max(30),
  }),
  address: { kind: 'none' },
  lifecycle: { approval: false, moderation: false, scheduling: false, risks: { publish: 'high' } },
})

/** Customer reviews: a person's words, moderated, with consent recorded. */
export const exampleReviewType = definePublisherDocumentType({
  type: 'review',
  label: { one: 'Review', many: 'Reviews' },
  fields: z.strictObject({
    reviewerId: identifierSchema,
    consent: publisherConsentSchema.optional(),
    rating: z.number().int().min(1).max(5),
    body: richTextSchema({ profile: 'block', max: 4000 }),
  }),
  address: { kind: 'none' },
  listing: { listable: true, order: 'published-desc', filterable: [] },
  lifecycle: { approval: false, moderation: true, scheduling: false },
  personalData: { subjectField: 'reviewerId', consentField: 'consent', retentionDays: 400 },
})

export const EXAMPLE_DOCUMENT_TYPES = [examplePageType, exampleBlogPostType, exampleMenuType, exampleReviewType] as const
