import { z } from 'zod'
import { adminSite, identifierParam, publisherHandler, readQuery, requireSubject } from '../../../../internal/http'
import { getPublisherDocument } from '../../../../utils/publisher-server'

/** GET /api/publisher/admin/documents/{id}?version=… — a document's newest or a given version. Needs `view-draft`. */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  const documentId = identifierParam(event, 'documentId')
  const { version } = readQuery(event, z.strictObject({ version: z.coerce.number().int().min(1).optional() }))
  return getPublisherDocument({ siteId: await adminSite(event), subject, documentId, version })
})
