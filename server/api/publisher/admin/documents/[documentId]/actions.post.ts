import { publisherActionRequestSchema } from '../../../../../../shared/contracts'
import { adminSite, correlationOf, identifierParam, publisherHandler, readJson, requireSubject } from '../../../../../internal/http'
import { transitionPublisherDocument } from '../../../../../utils/publisher-server'

/** POST /api/publisher/admin/documents/{id}/actions — one action of the state machine, with `expectedVersion`. */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  const documentId = identifierParam(event, 'documentId')
  const request = await readJson(event, publisherActionRequestSchema)
  return transitionPublisherDocument({ siteId: await adminSite(event), subject, correlationId: correlationOf(event), documentId, request })
})
