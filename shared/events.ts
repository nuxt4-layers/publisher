import { z } from 'zod'
import { correlationIdSchema, identifierSchema, instantSchema } from './identifiers'
import { typeKeySchema } from './types'

/**
 * Outbox events (docs/contracts.md §12). Identifiers, codes, counts and
 * times only: every schema is strict, so a title, a field, an address or a
 * name can never ride along.
 */

const envelope = {
  eventId: identifierSchema,
  occurredAt: instantSchema,
  correlationId: correlationIdSchema,
  /** `null` for maintenance and imports. */
  actorId: identifierSchema.nullable(),
}

const document = { documentId: identifierSchema, type: typeKeySchema }
const versioned = { ...document, version: z.number().int().min(1) }
const count = z.number().int().min(0)

export const publisherEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('publisher.document-created'), data: z.strictObject(versioned) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.document-saved'), data: z.strictObject({ ...versioned, restoredFrom: z.number().int().min(1).nullable() }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.review-requested'), data: z.strictObject({ ...versioned, approvalId: z.string().min(1).max(200) }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.review-withdrawn'), data: z.strictObject(document) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.document-scheduled'), data: z.strictObject({ ...versioned, publishAt: instantSchema, unpublishAt: instantSchema.nullable() }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.document-published'), data: z.strictObject({ ...versioned, unpublishAt: instantSchema.nullable() }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.document-unpublished'), data: z.strictObject({ ...document, reasonCode: z.enum(['unpublished', 'archived', 'expired', 'erased']) }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.document-reopened'), data: z.strictObject(document) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.address-changed'), data: z.strictObject({ ...document, redirectRecorded: z.boolean() }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.submission-received'), data: z.strictObject(document) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.submission-moderated'), data: z.strictObject({ ...document, outcome: z.enum(['accepted', 'rejected']) }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.person-erased'), data: z.strictObject({ identityId: identifierSchema, documents: count, versions: count }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.content-imported'), data: z.strictObject({ documents: count, versions: count }) }),
  z.strictObject({ ...envelope, type: z.literal('publisher.retention-applied'), data: z.strictObject({ versions: count }) }),
])

export type PublisherEvent = z.infer<typeof publisherEventSchema>
export type PublisherEventType = PublisherEvent['type']
