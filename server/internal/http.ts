import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, defineEventHandler, getQuery, getRequestHeader, getRequestHost, getRequestURL, getRouterParam, isError, readBody } from 'h3'
import type { z } from 'zod'
import type { PublisherErrorCode, PublisherSubject } from '../../shared/contracts'
import { PUBLISHER_ERROR_STATUS, PublisherCompositionError, PublisherFailure, siteIdSchema, subjectSchema, UUID_PATTERN, UUID_V7_PATTERN } from '../../shared/contracts'
import { usePublisherSiteResolver, usePublisherSubjectResolver } from '../utils/publisher-composition'

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
export const CORRELATION_HEADER = 'x-correlation-id'

const CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function publisherHttpError(code: PublisherErrorCode, reason?: string) {
  const data: { code: PublisherErrorCode, messageKey: string, reason?: string } = { code, messageKey: `publisher.error.${code}` }
  if (reason && (code === 'conflict' || code === 'validation-failed') && CODE.test(reason) && reason.length <= 64) data.reason = reason
  return createError({ statusCode: PUBLISHER_ERROR_STATUS[code], statusMessage: code, data })
}

/** Translates anything thrown inside a handler into a contract error. */
export function toHttpError(error: unknown) {
  if (isError(error)) return error
  if (error instanceof PublisherFailure) {
    if (error.code === 'unavailable') console.error('[publisher] request failed:', error.message)
    return publisherHttpError(error.code, error.reason)
  }
  if (error instanceof PublisherCompositionError) {
    console.error(`[publisher] ${error.message}`)
    return publisherHttpError('unavailable')
  }
  console.error('[publisher] unexpected failure:', error instanceof Error ? error.name : 'unknown')
  return publisherHttpError('unavailable')
}

/** Wraps a handler so that every failure leaves as a contract error. */
export function publisherHandler<T>(run: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await run(event)
    }
    catch (error) {
      throw toHttpError(error)
    }
  })
}

export function correlationOf(event: H3Event): string {
  const sent = getRequestHeader(event, CORRELATION_HEADER)?.toLowerCase()
  return sent && UUID_PATTERN.test(sent) ? sent : randomUUID()
}

/** The signed-in subject, or `null`. `unavailable` if the resolver fails or answers something malformed. */
export async function optionalSubject(event: H3Event): Promise<PublisherSubject | null> {
  let subject: unknown
  try {
    subject = await usePublisherSubjectResolver().resolve(event)
  }
  catch (error) {
    if (error instanceof PublisherCompositionError) throw error
    throw new PublisherFailure('unavailable', 'subject-resolver-failed')
  }
  if (subject == null) return null
  const parsed = subjectSchema.safeParse(subject)
  if (!parsed.success) throw new PublisherFailure('unavailable', 'subject-malformed')
  return parsed.data as PublisherSubject
}

export async function requireSubject(event: H3Event): Promise<PublisherSubject> {
  const subject = await optionalSubject(event)
  if (!subject) throw new PublisherFailure('unauthenticated')
  return subject
}

/** The request's site, from the host's resolver, or `null`. `unavailable` if the resolver fails or answers something malformed. */
export async function siteOfRequest(event: H3Event): Promise<string | null> {
  let site: unknown
  try {
    site = await usePublisherSiteResolver().resolve(event)
  }
  catch (error) {
    if (error instanceof PublisherCompositionError) throw error
    throw new PublisherFailure('unavailable', 'site-resolver-failed')
  }
  if (site == null) return null
  const parsed = siteIdSchema.safeParse(site)
  if (!parsed.success) throw new PublisherFailure('unavailable', 'site-malformed')
  return parsed.data
}

/** For readers: a request for no site finds nothing (`not-found`). */
export async function readerSite(event: H3Event): Promise<string> {
  const site = await siteOfRequest(event)
  if (site === null) throw new PublisherFailure('not-found')
  return site
}

/** For administration: a request for no site reaches nothing (`forbidden`). */
export async function adminSite(event: H3Event): Promise<string> {
  const site = await siteOfRequest(event)
  if (site === null) throw new PublisherFailure('forbidden')
  return site
}

export function identifierParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value || !UUID_V7_PATTERN.test(value)) throw new PublisherFailure('forbidden')
  return value
}

function issueCode(issues: readonly { message: string }[]): string | undefined {
  return issues.map(issue => issue.message).find(message => CODE.test(message))
}

export async function readJson<T>(event: H3Event, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await readBody(event)
  }
  catch {
    throw new PublisherFailure('validation-failed')
  }
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) throw new PublisherFailure('validation-failed', issueCode(parsed.error.issues))
  return parsed.data
}

export function readQuery<T>(event: H3Event, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(getQuery(event))
  if (!parsed.success) throw new PublisherFailure('validation-failed', issueCode(parsed.error.issues))
  return parsed.data
}

/** The request's origin, as its own host name gives it, for feeds' absolute addresses. */
export function originOf(event: H3Event): string {
  const url = getRequestURL(event)
  return `${url.protocol}//${getRequestHost(event).toLowerCase()}`
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for the state-changing endpoints: the request must carry an
 * Origin (or, failing that, a Referer) on the host it was sent to.
 */
export function originRejected(event: H3Event): boolean {
  if (!getRequestURL(event).pathname.startsWith(`${PUBLISHER_API_PREFIX}/`)) return false
  if (SAFE_METHODS.has(event.method)) return false
  const origin = getRequestHeader(event, 'origin')
  const referer = getRequestHeader(event, 'referer')
  try {
    const sent = origin ? new URL(origin) : referer ? new URL(referer) : null
    if (!sent || (sent.protocol !== 'https:' && sent.protocol !== 'http:')) return true
    return sent.host.toLowerCase() !== getRequestHost(event).toLowerCase()
  }
  catch {
    return true
  }
}
