import { getRouterParam, setResponseHeader } from 'h3'
import { PublisherFailure, TYPE_KEY_PATTERN } from '../../../../../shared/contracts'
import { originOf, publisherHandler, readerSite } from '../../../../internal/http'
import { getPublisherFeed } from '../../../../utils/publisher-server'

/** GET /api/publisher/feeds/{type}/atom — a listable type's Atom 1.0 feed, with the request's own origin. */
export default publisherHandler(async (event) => {
  const type = getRouterParam(event, 'type') ?? ''
  if (!TYPE_KEY_PATTERN.test(type)) throw new PublisherFailure('not-found')
  const siteId = await readerSite(event)
  let feed: string
  try {
    feed = await getPublisherFeed({ siteId, type, format: 'atom', origin: originOf(event) })
  }
  catch (error) {
    if (error instanceof PublisherFailure && error.reason === 'unknown-type') throw new PublisherFailure('not-found')
    throw error
  }
  setResponseHeader(event, 'content-type', 'application/atom+xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  return feed
})
