import { adminSite, identifierParam, publisherHandler, requireSubject } from '../../../../../internal/http'
import { listPublisherBacklinks } from '../../../../../utils/publisher-server'

/** GET /api/publisher/admin/documents/{id}/backlinks — every document linking to this one. Needs `view-draft`. */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  return listPublisherBacklinks({ siteId: await adminSite(event), subject, documentId: identifierParam(event, 'documentId') })
})
