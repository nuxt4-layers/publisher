import { getQuery } from 'h3'
import { z } from 'zod'
import { PUBLISHER_ORDERS, PublisherFailure, typeKeySchema } from '../../../shared/contracts'
import { publisherHandler } from '../../internal/http'
import { listPublishedDocuments } from '../../utils/publisher-server'

const known = z.strictObject({
  type: typeKeySchema,
  locale: z.string().max(35).optional(),
  order: z.enum(PUBLISHER_ORDERS).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
})

/** GET /api/publisher/documents?type=…&{field}=… — a listable type's published documents; other parameters filter. */
export default publisherHandler(async (event) => {
  const { type, locale, order, limit, offset, ...rest } = getQuery(event) as Record<string, unknown>
  const parsed = known.safeParse({ type, locale, order, limit, offset })
  if (!parsed.success) throw new PublisherFailure('validation-failed')
  const filters: Record<string, string> = {}
  for (const [field, value] of Object.entries(rest)) {
    if (typeof value !== 'string' || value.length > 200 || field.length > 64) throw new PublisherFailure('validation-failed')
    filters[field] = value
  }
  return listPublishedDocuments({ ...parsed.data, filters })
})
