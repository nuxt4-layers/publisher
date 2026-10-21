import { z } from 'zod'
import { PUBLISHER_MODERATION_STATES, PUBLISHER_STATUSES, publisherContentSchema } from './documents'
import { identifierSchema, instantSchema } from './identifiers'
import { typeKeySchema } from './types'
import { sitePathSchema } from './values'

/**
 * The portable bundle (docs/contracts.md §16): envelopes, every version's
 * content and the redirects to each document, by type or entirely. An
 * import is also how a host seeds content.
 */

export const PUBLISHER_BUNDLE_FORMAT = 'nuxt4-layers.publisher'

export const publisherBundleDocumentSchema = z.strictObject({
  id: identifierSchema,
  type: typeKeySchema,
  status: z.enum(PUBLISHER_STATUSES),
  publishedVersion: z.number().int().min(1).nullable(),
  reviewVersion: z.number().int().min(1).nullable(),
  moderation: z.enum(PUBLISHER_MODERATION_STATES).nullable(),
  publishAt: instantSchema.nullable(),
  unpublishAt: instantSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  publishedAt: instantSchema.nullable(),
  versions: z.array(z.strictObject({
    version: z.number().int().min(1),
    savedAt: instantSchema,
    savedBy: identifierSchema.nullable(),
    restoredFrom: z.number().int().min(1).nullable(),
    content: publisherContentSchema,
  })).min(1),
  /** Old addresses that redirect to this document. */
  redirects: z.array(sitePathSchema),
})
export type PublisherBundleDocument = z.infer<typeof publisherBundleDocumentSchema>

export const publisherBundleSchema = z.strictObject({
  format: z.literal(PUBLISHER_BUNDLE_FORMAT),
  version: z.literal(1),
  exportedAt: instantSchema,
  types: z.array(typeKeySchema),
  documents: z.array(publisherBundleDocumentSchema),
})
export type PublisherBundle = z.infer<typeof publisherBundleSchema>

/** A person's documents and every version of them, for their data-subject export (§9). */
export const publisherPersonExportSchema = z.strictObject({
  format: z.literal(`${PUBLISHER_BUNDLE_FORMAT}.person`),
  version: z.literal(1),
  identityId: identifierSchema,
  exportedAt: instantSchema,
  documents: z.array(publisherBundleDocumentSchema),
})
export type PublisherPersonExport = z.infer<typeof publisherPersonExportSchema>
