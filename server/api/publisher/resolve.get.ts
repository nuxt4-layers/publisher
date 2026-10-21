import { setResponseHeader } from 'h3'
import { z } from 'zod'
import { optionalSubject, publisherHandler, readerSite, readQuery } from '../../internal/http'
import { resolvePublisherPath } from '../../utils/publisher-server'

const query = z.strictObject({ path: z.string().max(1024), preview: z.literal('1').optional() })

/**
 * GET /api/publisher/resolve?path=…&preview=1 — what a request path is now:
 * a document, a redirect or nothing. A draft without `view-draft` answers
 * exactly as a missing document.
 */
export default publisherHandler(async (event) => {
  const { path, preview } = readQuery(event, query)
  const siteId = await readerSite(event)
  const viewer = preview ? await optionalSubject(event) : null
  setResponseHeader(event, 'cache-control', preview ? 'private, no-store' : 'public, max-age=60')
  return resolvePublisherPath({ siteId, path, viewer, preview: preview === '1' })
})
