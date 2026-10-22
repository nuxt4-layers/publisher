import { defineEventHandler, getRequestURL } from 'h3'
import { originRejected, PUBLISHER_API_PREFIX, publisherApiAbsent, publisherApiEnabled, publisherHttpError } from '../internal/http'

/**
 * CSRF defence for `/api/publisher/*`: state-changing requests must come from
 * the host they were sent to. A switched-off API answers 404 here first, so
 * it looks absent, never forbidden.
 */
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!publisherApiEnabled() && (path === PUBLISHER_API_PREFIX || path.startsWith(`${PUBLISHER_API_PREFIX}/`))) throw publisherApiAbsent()
  if (originRejected(event)) throw publisherHttpError('forbidden')
})
