import type { H3Event } from 'h3'
import type { PublisherErrorCode } from '../../shared/contracts'
import { pending } from '../../shared/pending'

/**
 * PRIVATE. The HTTP boundary of `/api/publisher/*` (docs/contracts.md §14).
 *
 * - Errors cross as `{ code, messageKey, reason? }`: a reason code for
 *   `validation-failed` and `conflict` only, never a value.
 * - Bodies and queries are parsed with strict schemas.
 * - The subject comes only from the host's resolver.
 * - Every handler is wrapped in `publisherHandler`.
 */

export const PUBLISHER_API_PREFIX = '/api/publisher'

export function publisherHttpError(code: PublisherErrorCode, reason?: string): Error {
  return pending(`publisherHttpError(${code}, ${reason})`)
}

/** CSRF defence: a state-changing request must carry an Origin (or Referer) on the host it was sent to. */
export function originRejected(event: H3Event): boolean {
  return pending(`originRejected(${event.method})`)
}
