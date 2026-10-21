import { z } from 'zod'
import { PUBLISHER_STATUSES, typeKeySchema } from '../../../../shared/contracts'
import { publisherHandler, readQuery, requireSubject } from '../../../internal/http'
import { listPublisherDocuments } from '../../../utils/publisher-server'

const query = z.strictObject({
  type: typeKeySchema,
  search: z.string().max(100).optional(),
  status: z.enum(PUBLISHER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
})

/** GET /api/publisher/admin/documents?type=… — a type's documents, newest change first. Needs `view-draft`. */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  return listPublisherDocuments({ subject, ...readQuery(event, query) })
})
