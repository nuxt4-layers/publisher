import { defineEventHandler } from 'h3'
import { originRejected, publisherHttpError } from '../internal/http'

/** CSRF defence for `/api/publisher/*`: state-changing requests must come from the host they were sent to. */
export default defineEventHandler((event) => {
  if (originRejected(event)) throw publisherHttpError('forbidden')
})
