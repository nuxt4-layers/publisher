import { setResponseStatus } from 'h3'
import { z } from 'zod'
import { typeKeySchema } from '../../../../shared/contracts'
import { correlationOf, publisherHandler, readJson, requireSubject } from '../../../internal/http'
import { createPublisherDocument } from '../../../utils/publisher-server'

const body = z.strictObject({ type: typeKeySchema, content: z.record(z.string(), z.unknown()) })

/** POST /api/publisher/admin/documents — creates a draft. Needs `edit`. */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  const { type, content } = await readJson(event, body)
  const document = await createPublisherDocument({ subject, correlationId: correlationOf(event), type, content: content as never })
  setResponseStatus(event, 201)
  return document
})
