import { z } from 'zod'
import { typeKeySchema } from '../../../../shared/contracts'
import { publisherHandler, readQuery, requireSubject } from '../../../internal/http'
import { listPublisherModerationQueue } from '../../../utils/publisher-server'

/** GET /api/publisher/admin/moderation — submissions awaiting a moderator, of the types the subject may moderate. */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  const { type } = readQuery(event, z.strictObject({ type: typeKeySchema.optional() }))
  return listPublisherModerationQueue({ subject, type })
})
