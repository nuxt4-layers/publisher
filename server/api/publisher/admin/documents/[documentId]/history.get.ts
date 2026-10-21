import { identifierParam, publisherHandler, requireSubject } from '../../../../../internal/http'
import { listPublisherHistory } from '../../../../../utils/publisher-server'

/** GET /api/publisher/admin/documents/{id}/history — every saved version, newest first. Needs `view-draft`. */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  return listPublisherHistory({ subject, documentId: identifierParam(event, 'documentId') })
})
