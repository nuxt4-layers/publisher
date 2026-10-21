import { setResponseHeader } from 'h3'
import { PublisherFailure } from '../../../../../../shared/contracts'
import { identifierParam, publisherHandler, requireSubject } from '../../../../../internal/http'
import { getPublishedDocument } from '../../../../../utils/publisher-server'

/** GET /api/publisher/admin/documents/{id}/preview — the newest version, ready to render. Needs `view-draft`. */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  const rendered = await getPublishedDocument({ documentId: identifierParam(event, 'documentId'), viewer: subject, preview: true })
  if (!rendered || !rendered.preview) throw new PublisherFailure('forbidden')
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return rendered
})
