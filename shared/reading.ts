import { z } from 'zod'
import { publisherDocumentSchema } from './documents'
import { identifierSchema, instantSchema } from './identifiers'
import { PUBLISHER_ORDERS, typeKeySchema } from './types'
import { RICH_TEXT_PROFILES, richTextTreeSchema } from '@nuxt4-layers/rich-text'
import { siteIdSchema, sitePathSchema } from './values'

/** Reading published documents (docs/contracts.md §7, §8). */

/** What `doc:` and `asset:` links in a document resolve to now: an address, or `null` (rendered as text). */
export const publisherResolvedLinksSchema = z.strictObject({
  documents: z.record(identifierSchema, sitePathSchema.nullable()),
  assets: z.record(z.string(), z.strictObject({ url: z.string(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }).nullable()),
})
export type PublisherResolvedLinks = z.infer<typeof publisherResolvedLinksSchema>

/** Metadata for the host's page: title, description, canonical path and times (§15). */
export const publisherHeadSchema = z.strictObject({
  title: z.string(),
  description: z.string().nullable(),
  canonicalPath: sitePathSchema.nullable(),
  locale: z.string(),
  publishedAt: instantSchema.nullable(),
  modifiedAt: instantSchema,
})
export type PublisherHead = z.infer<typeof publisherHeadSchema>

/** A document ready to render: its published version, or with `view-draft` a preview of its newest. */
export const publisherRenderedSchema = z.strictObject({
  document: publisherDocumentSchema,
  links: publisherResolvedLinksSchema,
  /**
   * Each formatted field's safe tree, in the order the type declares them: its
   * path in `fields` (`blocks[0].body`), its profile, and its nodes. Never HTML.
   */
  richText: z.array(z.strictObject({
    path: z.string().max(400),
    profile: z.enum(RICH_TEXT_PROFILES),
    nodes: richTextTreeSchema,
  })).max(1000),
  head: publisherHeadSchema,
  preview: z.boolean(),
})
export type PublisherRendered = z.infer<typeof publisherRenderedSchema>

/** What a request path resolves to (§7.1). */
export const publisherResolutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('document'), rendered: publisherRenderedSchema }),
  z.strictObject({ kind: z.literal('redirect'), to: sitePathSchema, status: z.literal(301) }),
  z.strictObject({ kind: z.literal('none') }),
])
export type PublisherResolution = z.infer<typeof publisherResolutionSchema>

/** A listing query (§8.1). Filters name only the type's `filterable` fields. */
export const publisherListingQuerySchema = z.strictObject({
  siteId: siteIdSchema,
  type: typeKeySchema,
  locale: z.string().max(35).optional(),
  filters: z.record(z.string().max(64), z.string().max(200)).default({}),
  order: z.enum(PUBLISHER_ORDERS).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(10_000).default(0),
})
export type PublisherListingQuery = z.input<typeof publisherListingQuerySchema>

export const publisherListingSchema = z.strictObject({
  documents: z.array(publisherDocumentSchema),
  total: z.number().int().min(0),
})
export type PublisherListing = z.infer<typeof publisherListingSchema>

/** A sitemap entry for the host to combine with its own into `sitemap.xml` (§8.3). */
export const publisherSitemapEntrySchema = z.strictObject({
  path: sitePathSchema,
  lastModified: instantSchema,
  type: typeKeySchema,
})
export type PublisherSitemapEntry = z.infer<typeof publisherSitemapEntrySchema>

export const PUBLISHER_FEED_FORMATS = ['rss', 'atom'] as const
export type PublisherFeedFormat = typeof PUBLISHER_FEED_FORMATS[number]
