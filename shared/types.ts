import { z } from 'zod'
import { pending } from './pending'
import { safeTextSchema, sitePathSchema } from './values'

/**
 * Document types, registered by the host (docs/contracts.md §3). The
 * publisher knows no type of its own: a type is a strict declaration, and
 * adding one is a registration, never a change to the layer.
 */

/** Risk levels, in Authorisation's catalogue's sense. */
export const PUBLISHER_RISKS = ['low', 'medium', 'high', 'critical'] as const
export type PublisherRisk = typeof PUBLISHER_RISKS[number]

export function riskRank(risk: PublisherRisk): number {
  return PUBLISHER_RISKS.indexOf(risk)
}

/** What a permission lets its holder do to documents of one type (§10). */
export const PUBLISHER_PERMISSION_ACTIONS = ['view-draft', 'edit', 'publish', 'moderate'] as const
export type PublisherPermissionAction = typeof PUBLISHER_PERMISSION_ACTIONS[number]

/** The lowest risk a type may declare for each permission. */
export const PUBLISHER_RISK_FLOOR: Readonly<Record<PublisherPermissionAction, PublisherRisk>> = {
  'view-draft': 'low',
  'edit': 'low',
  'publish': 'medium',
  'moderate': 'medium',
}

/** For types holding personal data, drafts and edits are at least `medium` too. */
export const PUBLISHER_PERSONAL_DATA_RISK_FLOOR: Readonly<Record<PublisherPermissionAction, PublisherRisk>> = {
  'view-draft': 'medium',
  'edit': 'medium',
  'publish': 'medium',
  'moderate': 'medium',
}

/** A type's key: lower-case ASCII with `-`, as a segment of Configuration's keys. */
export const TYPE_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/
export const typeKeySchema = z.string().regex(TYPE_KEY_PATTERN, 'not-a-type')

/** A field's name in a type's `fields`. */
export const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/

/**
 * A path to a Markdown field: a field name, then `.name` into an object or
 * `[].name` into each item of an array (`intro`, `blocks[].body`).
 */
export const FIELD_PATH_PATTERN = /^[a-z][A-Za-z0-9]{0,63}(?:(?:\[\])?\.[a-z][A-Za-z0-9]{0,63}){0,4}$/

/** How listings of a type are ordered by default. */
export const PUBLISHER_ORDERS = ['published-desc', 'published-asc', 'title-asc', 'updated-desc'] as const
export type PublisherOrder = typeof PUBLISHER_ORDERS[number]

/** How long history of a personal-data type is kept, in days (§9). */
export const PUBLISHER_RETENTION = { minimumDays: 30, maximumDays: 2190 } as const

/** How a published document is reached (§3.2). */
export const addressRuleSchema = z.discriminatedUnion('kind', [
  // Only ever embedded or listed: no address of its own.
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('path'),
    /** The route base: `''` for the site's root, or a site path such as `/news`. */
    base: z.union([z.literal(''), sitePathSchema.regex(/[^/]$/, 'trailing-slash')]),
    /** `slug`: `{base}/{slug}`. `date-slug`: `{base}/{YYYY}/{MM}/{DD}/{slug}`. */
    pattern: z.enum(['slug', 'date-slug']),
  }),
])
export type PublisherAddressRule = z.infer<typeof addressRuleSchema>

/**
 * The meta-schema every declaration is checked against at start-up (§3.1).
 * The structure is here; `buildPublisherRegistry` adds the checks that need
 * the type's own `fields` (strict objects, bounded strings, the fields named
 * elsewhere exist and have the right shape).
 */
export const publisherTypeDeclarationSchema = z.strictObject({
  type: typeKeySchema,
  label: z.strictObject({ one: safeTextSchema({ max: 60 }), many: safeTextSchema({ max: 60 }) }),
  fields: z.custom<z.ZodObject>(value => value instanceof z.ZodObject, 'not-a-strict-object'),
  markdownFields: z.array(z.string().regex(FIELD_PATH_PATTERN)).max(20).default([]),
  address: addressRuleSchema,
  listing: z.strictObject({
    listable: z.boolean(),
    order: z.enum(PUBLISHER_ORDERS).default('published-desc'),
    filterable: z.array(z.string().regex(FIELD_NAME_PATTERN)).max(10).default([]),
  }).default({ listable: false, order: 'published-desc', filterable: [] }),
  lifecycle: z.strictObject({
    /** Publishing needs the approval port's consent (§5.2). */
    approval: z.boolean().default(false),
    /** Submissions wait, hidden, for a moderator (§5.3). Not with `approval`. */
    moderation: z.boolean().default(false),
    /** `publishAt` and `unpublishAt` may be set. */
    scheduling: z.boolean().default(false),
    /** Each permission's risk; never below the floor. Omitted: the floor. */
    risks: z.partialRecord(z.enum(PUBLISHER_PERMISSION_ACTIONS), z.enum(PUBLISHER_RISKS)).default({}),
  }).default({ approval: false, moderation: false, scheduling: false, risks: {} }),
  personalData: z.strictObject({
    /** The field holding the person's opaque identity identifier. */
    subjectField: z.string().regex(FIELD_NAME_PATTERN),
    /** The field holding the person's recorded consent (`publisherConsentSchema`). */
    consentField: z.string().regex(FIELD_NAME_PATTERN),
    retentionDays: z.number().int().min(PUBLISHER_RETENTION.minimumDays).max(PUBLISHER_RETENTION.maximumDays),
  }).nullable().default(null),
})

export type PublisherTypeDeclarationInput = z.input<typeof publisherTypeDeclarationSchema>
/** A declaration as registered: every default filled in, frozen. */
export type PublisherTypeDeclaration = z.output<typeof publisherTypeDeclarationSchema> & {
  /** Each permission's risk, the declared one or the floor. */
  readonly risks: Readonly<Record<PublisherPermissionAction, PublisherRisk>>
  /** The type's fields as JSON Schema, for the generic edit form. */
  readonly jsonSchema: Readonly<Record<string, unknown>>
}

export type PublisherRegistry = ReadonlyMap<string, PublisherTypeDeclaration>

/** Typed helper for declaring a type. */
export function definePublisherDocumentType<const Declaration extends PublisherTypeDeclarationInput>(declaration: Declaration): Declaration {
  return declaration
}

/**
 * Builds the registry, refusing at start-up anything a page would
 * otherwise find out about later: an invalid declaration against the
 * meta-schema, a type registered twice, a `fields` schema that is not a
 * strict object or holds an unbounded string or array, a Markdown,
 * filterable, subject or consent field the schema does not have (or of the
 * wrong shape), `approval` with `moderation`, and a risk below the floor.
 */
export function buildPublisherRegistry(declarations: readonly PublisherTypeDeclarationInput[]): PublisherRegistry {
  return pending(`buildPublisherRegistry(${declarations.length})`)
}

/** The permission for an action on a type: `publisher.<type>.<action>`. */
export function publisherPermission(type: string, action: PublisherPermissionAction): string {
  return pending(`publisherPermission(${type}, ${action})`)
}

/** Every permission the registry derives, with its risk, for the host to add to Authorisation's catalogue (§10). */
export function publisherPermissions(registry: PublisherRegistry): readonly { permission: string, risk: PublisherRisk, type: string, action: PublisherPermissionAction }[] {
  return pending(`publisherPermissions(${registry.size})`)
}
