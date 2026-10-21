import { z } from 'zod'

/**
 * Building blocks for the envelope and for the fields a type declares
 * (docs/contracts.md §3, §4). Every string is bounded; text carries no
 * markup and pages render it as text.
 */

const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u

function codePoints(value: string): number {
  return [...value].length
}

/** Safe text: NFC, spaces collapsed and trimmed, no control, format or private-use characters. */
export function safeTextSchema({ min = 1, max }: { min?: number, max: number }) {
  return z.string()
    .max(max * 4, 'too-long')
    .overwrite(value => value.normalize('NFC').replace(/\s+/gu, ' ').trim())
    .refine(value => !UNSAFE_CHARACTERS.test(value), 'unsafe-characters')
    .refine(value => codePoints(value) >= min, 'too-short')
    .refine(value => codePoints(value) <= max, 'too-long')
}

/** The most Markdown one field may hold, in characters. */
export const MARKDOWN_MAX_LENGTH = 100_000

/**
 * A Markdown field's source, in the shared dialect (§6). Bounded, NFC, no
 * control characters but tab and newline. Its constructs are checked on save.
 */
export function markdownSchema({ max = MARKDOWN_MAX_LENGTH }: { max?: number } = {}) {
  return z.string()
    .max(Math.min(max, MARKDOWN_MAX_LENGTH), 'too-long')
    .overwrite(value => value.normalize('NFC').replace(/\r\n?/g, '\n'))
    .refine(value => !/[\p{Cc}\p{Co}\p{Cs}]/u.test(value.replace(/[\t\n]/g, '')), 'unsafe-characters')
}

/** An `https` URL without credentials, at most 2,048 characters. */
export const httpsUrlSchema = z.string().max(2048, 'too-long').refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch {
    return false
  }
}, 'not-an-https-url')

/** A site-relative path such as `/about/team`: no scheme, no host, no `..`. */
export const sitePathSchema = z.string().max(512, 'too-long').regex(/^\/(?!\/)[A-Za-z0-9\-._~/%]*$/, 'not-a-site-path').refine(value => !value.split('/').includes('..'), 'not-a-site-path')

/** A BCP 47 language tag, e.g. `en-GB`, `cy-GB`. */
export const localeSchema = z.string().max(35).regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'not-a-locale')

/**
 * A site: the host's opaque identifier of where documents are published,
 * such as Identity's tenant identifier, or one fixed name for a host with
 * one site. Lower-case ASCII letters, digits and `-`, 1 to 64 characters.
 */
export const SITE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
export const siteIdSchema = z.string().regex(SITE_ID_PATTERN, 'not-a-site')

/** A code chosen from a list: `rating-scale`, `consent-given`. */
export const codeSchema = z.string().max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'not-a-code')

/**
 * A slug: up to 8 segments of lower-case ASCII letters and digits joined by
 * `-`, separated by `/` (`about/team`); at most 200 characters. The empty
 * slug is the route base itself.
 */
export const SLUG_PATTERN = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,7})?$/
export const slugSchema = z.string().max(200, 'too-long').regex(SLUG_PATTERN, 'not-a-slug')

/** A calendar date, `YYYY-MM-DD`, for addresses that carry one. */
export const addressDateSchema = z.iso.date({ error: 'not-a-date' })

/** An identifier in the host's asset store, as written after `asset:`. */
export const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
export const assetIdSchema = z.string().regex(ASSET_ID_PATTERN, 'not-an-asset-id')

/** JSON with object keys sorted, so a digest does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}
