/**
 * Failure categories at the publisher's boundary (docs/contracts.md §14.1).
 *
 * `not-found` is what a reader is told about anything they may not see: a
 * draft without `view-draft` answers exactly as a missing document does.
 * `forbidden` never says whether a document exists, or which rule refused.
 */
export const PUBLISHER_ERROR_CODES = [
  'unauthenticated',
  'forbidden',
  'not-found',
  'insufficient-assurance',
  'validation-failed',
  'conflict',
  'unavailable',
] as const

export type PublisherErrorCode = typeof PUBLISHER_ERROR_CODES[number]

export const PUBLISHER_ERROR_STATUS: Readonly<Record<PublisherErrorCode, number>> = {
  'unauthenticated': 401,
  'forbidden': 403,
  'not-found': 404,
  'insufficient-assurance': 403,
  'validation-failed': 400,
  'conflict': 409,
  'unavailable': 503,
}

/** Why an action conflicted. Codes only. */
export const PUBLISHER_CONFLICT_REASONS = [
  'version-stale',
  'invalid-transition',
  'address-taken',
  'review-required',
  'approval-missing',
  'consent-missing',
  'scheduling-disabled',
  'still-linked',
  'not-moderated',
  'erased',
] as const

export type PublisherConflictReason = typeof PUBLISHER_CONFLICT_REASONS[number]

/** Problems a document's content can have, beyond its fields' own schema codes. */
export const PUBLISHER_CONTENT_PROBLEMS = [
  'unknown-type',
  'not-a-slug',
  'address-required',
  'address-not-allowed',
  'date-required',
  'not-in-profile',
  'more-than-one-paragraph',
  'image-without-alt',
  'image-not-asset',
  'images-unavailable',
  'unknown-filter',
] as const

export type PublisherContentProblem = typeof PUBLISHER_CONTENT_PROBLEMS[number]

/** Raised when the host has not supplied a required port, or a registration is wrong. The publisher fails closed. */
export class PublisherCompositionError extends Error {
  readonly port: string

  constructor(port: string, detail?: string) {
    super(detail ?? `Publisher port '${port}' has not been supplied by the host application.`)
    this.name = 'PublisherCompositionError'
    this.port = port
  }
}

/**
 * A server function's failure, carrying a contract code and, for
 * `validation-failed` and `conflict`, a reason code. The detail never names
 * a value.
 */
export class PublisherFailure extends Error {
  readonly code: PublisherErrorCode
  readonly reason?: string

  constructor(code: PublisherErrorCode, reason?: string) {
    super(reason ? `${code}: ${reason}` : code)
    this.name = 'PublisherFailure'
    this.code = code
    this.reason = reason
  }
}
