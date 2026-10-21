import { z } from 'zod'
import { identifierSchema, instantSchema, reasonCodeSchema } from './identifiers'
import { typeKeySchema } from './types'
import { addressDateSchema, localeSchema, safeTextSchema, siteIdSchema, sitePathSchema, slugSchema } from './values'

/**
 * The document envelope (docs/contracts.md §4): the same for every type.
 * A type's own content lives in `fields`, checked against its declaration.
 */

export const PUBLISHER_STATUSES = ['draft', 'in-review', 'scheduled', 'published', 'archived'] as const
export type PublisherStatus = typeof PUBLISHER_STATUSES[number]

export const PUBLISHER_MODERATION_STATES = ['pending', 'accepted', 'rejected'] as const
export type PublisherModerationState = typeof PUBLISHER_MODERATION_STATES[number]

const fieldsSchema = z.record(z.string().max(64), z.unknown())

/** What an editor writes: the content of one version. */
export const publisherContentSchema = z.strictObject({
  locale: localeSchema,
  title: safeTextSchema({ max: 200 }),
  summary: safeTextSchema({ min: 0, max: 500 }).nullable().default(null),
  fields: fieldsSchema,
  /** Required for addressed types, refused for `none` (§3.2). */
  slug: slugSchema.nullable().default(null),
  /** Required for `date-slug` addresses; the first publishing date when omitted. */
  addressDate: addressDateSchema.nullable().default(null),
  /** Opaque identity identifiers; names are the host's (§15). */
  authors: z.array(identifierSchema).max(20).default([]),
})
export type PublisherContent = z.output<typeof publisherContentSchema>
export type PublisherContentInput = z.input<typeof publisherContentSchema>

/** A new document: its type and the first version's content. */
export const publisherDraftSchema = z.strictObject({
  type: typeKeySchema,
  content: publisherContentSchema,
})
export type PublisherDraft = z.output<typeof publisherDraftSchema>

/** Consent to publish a person's words or identity, recorded as a field (§9). */
export const publisherConsentSchema = z.strictObject({
  givenAt: instantSchema,
  /** The code of the statement the person agreed to, e.g. `testimonial-v2`. */
  statement: reasonCodeSchema,
})
export type PublisherConsent = z.infer<typeof publisherConsentSchema>

/** A document as the layer answers it: one version's content in the envelope. */
export const publisherDocumentSchema = z.strictObject({
  id: identifierSchema,
  /** The site the document belongs to; it is never served on another (§3.4). */
  siteId: siteIdSchema,
  type: typeKeySchema,
  ...publisherContentSchema.shape,
  summary: safeTextSchema({ min: 0, max: 500 }).nullable(),
  slug: slugSchema.nullable(),
  addressDate: addressDateSchema.nullable(),
  authors: z.array(identifierSchema).max(20),
  /** The address the slug and date give, or `null` for types without one. */
  path: sitePathSchema.nullable(),
  status: z.enum(PUBLISHER_STATUSES),
  /** The version these contents are. */
  version: z.number().int().min(1),
  /** The newest version saved. */
  latestVersion: z.number().int().min(1),
  /** The version readers see, while the document is published. */
  publishedVersion: z.number().int().min(1).nullable(),
  /** A newer version of a published document awaiting the approval port (§5.2). */
  reviewVersion: z.number().int().min(1).nullable(),
  moderation: z.enum(PUBLISHER_MODERATION_STATES).nullable(),
  publishAt: instantSchema.nullable(),
  unpublishAt: instantSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  publishedAt: instantSchema.nullable(),
})
export type PublisherDocument = z.infer<typeof publisherDocumentSchema>

/** One saved version, as history lists it. */
export const publisherVersionSchema = z.strictObject({
  documentId: identifierSchema,
  version: z.number().int().min(1),
  savedAt: instantSchema,
  savedBy: identifierSchema.nullable(),
  /** The version this one restored, when it was a restore. */
  restoredFrom: z.number().int().min(1).nullable(),
  /** SHA-256 of the canonical JSON of the document's id, type, version and content. */
  digest: z.string().regex(/^[0-9a-f]{64}$/),
})
export type PublisherVersion = z.infer<typeof publisherVersionSchema>

/** A document linking to another, by id (§7.3). */
export const publisherBacklinkSchema = z.strictObject({
  documentId: identifierSchema,
  type: typeKeySchema,
  status: z.enum(PUBLISHER_STATUSES),
  /** `null` where the viewer may not see the linking document's drafts. */
  title: z.string().nullable(),
})
export type PublisherBacklink = z.infer<typeof publisherBacklinkSchema>
