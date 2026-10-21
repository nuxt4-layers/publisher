import { PUBLISHER_PERMISSION_ACTIONS } from '../../../../shared/contracts'
import { adminSite, publisherHandler, requireSubject } from '../../../internal/http'
import { allows } from '../../../internal/store'
import { usePublisherRegistry } from '../../../utils/publisher-composition'

/**
 * GET /api/publisher/admin/types — the registered types the subject holds
 * any permission on, with what the administration pages need to build their
 * forms. For the user experience only: every action is decided again.
 */
export default publisherHandler(async (event) => {
  const subject = await requireSubject(event)
  const siteId = await adminSite(event)
  const types = []
  for (const declaration of usePublisherRegistry().values()) {
    const may = Object.fromEntries(await Promise.all(PUBLISHER_PERMISSION_ACTIONS.map(async action => [action, await allows(subject, siteId, declaration.type, action, null)] as const)))
    if (!Object.values(may).some(Boolean)) continue
    types.push({
      type: declaration.type,
      label: declaration.label,
      address: declaration.address,
      listing: declaration.listing,
      lifecycle: { approval: declaration.lifecycle.approval, moderation: declaration.lifecycle.moderation, scheduling: declaration.lifecycle.scheduling },
      personalData: declaration.personalData !== null,
      richTextFields: declaration.richTextFields,
      risks: declaration.risks,
      schema: declaration.jsonSchema,
      may,
    })
  }
  return types
})
