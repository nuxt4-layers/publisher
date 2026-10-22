import { richTextFields, type RichTextFieldPath } from '@nuxt4-layers/rich-text'
import { z } from 'zod'
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

/** The most formatted fields (`richTextSchema`) one type may have. */
export const PUBLISHER_MAX_RICH_TEXT_FIELDS = 20

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
  /** Its formatted fields, found from `fields` (`richTextSchema`), in order. */
  readonly richTextFields: readonly RichTextFieldPath[]
}

export type PublisherRegistry = ReadonlyMap<string, PublisherTypeDeclaration>

/**
 * What an editor is told about a type (`/api/publisher/admin/types`):
 * enough to build its form. The server checks every save.
 */
export interface PublisherEditorType {
  type: string
  label: { one: string, many: string }
  address: PublisherAddressRule
  /** Its formatted fields: each path, profile and maximum length. Every other string is plain. */
  richTextFields: readonly RichTextFieldPath[]
  /** The type's fields as JSON Schema (input). */
  schema: Readonly<Record<string, unknown>>
}

/** Typed helper for declaring a type. */
export function definePublisherDocumentType<const Declaration extends PublisherTypeDeclarationInput>(declaration: Declaration): Declaration {
  return declaration
}

/**
 * Builds the registry, refusing at start-up anything a page would
 * otherwise find out about later: an invalid declaration against the
 * meta-schema, a type registered twice, a `fields` schema that is not a
 * strict object, holds an unbounded string or array or too many
 * formatted fields, a filterable, subject or consent field the schema
 * does not have (or of the wrong shape), `approval` with `moderation`, and a risk below the floor.
 */
export function buildPublisherRegistry(declarations: readonly PublisherTypeDeclarationInput[]): PublisherRegistry {
  const registry = new Map<string, PublisherTypeDeclaration>()
  for (const input of declarations) {
    const parsed = publisherTypeDeclarationSchema.safeParse(input)
    const name = typeof (input as { type?: unknown })?.type === 'string' ? (input as { type: string }).type : '?'
    if (!parsed.success) throw new TypeError(`Document type '${name}' is invalid against the meta-schema (${parsed.error.issues[0]?.path.join('.') || 'declaration'}: ${parsed.error.issues[0]?.message}).`)
    const declaration = parsed.data
    if (registry.has(declaration.type)) throw new TypeError(`Document type '${declaration.type}' is registered twice.`)
    let jsonSchema: JsonNode
    try {
      jsonSchema = z.toJSONSchema(declaration.fields, { io: 'input', unrepresentable: 'any' }) as JsonNode
    }
    catch {
      throw new TypeError(`Document type '${declaration.type}' has fields that cannot be described.`)
    }
    const problem = unbounded(jsonSchema, jsonSchema, new Set())
    if (problem) throw new TypeError(`Document type '${declaration.type}' has ${problem} in its fields.`)
    const fail = (what: string) => {
      throw new TypeError(`Document type '${declaration.type}' ${what}.`)
    }
    const formatted = richTextFields(declaration.fields)
    if (formatted.length > PUBLISHER_MAX_RICH_TEXT_FIELDS) fail(`has more than ${PUBLISHER_MAX_RICH_TEXT_FIELDS} formatted fields`)
    for (const field of declaration.listing.filterable) {
      const node = topField(jsonSchema, field)
      if (!node || !(isFilterable(node) || (isType(node, 'array') && isFilterable(deref(jsonSchema, node.items as JsonNode | undefined))))) fail(`names filterable field '${field}', which is not a string, enumeration or array of either`)
    }
    if (declaration.lifecycle.approval && declaration.lifecycle.moderation) fail('declares both approval and moderation')
    if (declaration.personalData) {
      const subject = topField(jsonSchema, declaration.personalData.subjectField)
      if (!subject || !isType(subject, 'string')) fail(`names subject field '${declaration.personalData.subjectField}', which is not a string field`)
      const consent = topField(jsonSchema, declaration.personalData.consentField)
      const properties = consent?.properties as Record<string, unknown> | undefined
      if (!consent || !properties?.givenAt || !properties?.statement) fail(`names consent field '${declaration.personalData.consentField}', which is not a consent record`)
    }
    const floor = declaration.personalData ? PUBLISHER_PERSONAL_DATA_RISK_FLOOR : PUBLISHER_RISK_FLOOR
    const risks = {} as Record<PublisherPermissionAction, PublisherRisk>
    for (const action of PUBLISHER_PERMISSION_ACTIONS) {
      const declared = declaration.lifecycle.risks[action]
      if (declared !== undefined && riskRank(declared) < riskRank(floor[action])) fail(`declares '${action}' at '${declared}', below the floor '${floor[action]}'`)
      risks[action] = declared ?? floor[action]
    }
    const { $schema: _, ...schema } = jsonSchema
    registry.set(declaration.type, Object.freeze({ ...declaration, risks: Object.freeze(risks), jsonSchema: Object.freeze(schema), richTextFields: Object.freeze(formatted.map(field => Object.freeze(field))) }))
  }
  return registry
}

type JsonNode = Record<string, unknown>

function deref(root: JsonNode, node: JsonNode | undefined): JsonNode | undefined {
  if (!node || typeof node.$ref !== 'string') return node
  const ref = node.$ref
  if (ref === '#') return root
  const match = /^#\/\$defs\/(.+)$/.exec(ref)
  return match ? (root.$defs as Record<string, JsonNode> | undefined)?.[match[1]!] : undefined
}

function alternatives(root: JsonNode, node: JsonNode | undefined): JsonNode[] {
  const resolved = deref(root, node)
  if (!resolved) return []
  const options = (resolved.anyOf ?? resolved.oneOf) as JsonNode[] | undefined
  return options ? options.flatMap(option => alternatives(root, option)) : [resolved]
}

function isType(node: JsonNode, type: string): boolean {
  return node.type === type || (Array.isArray(node.type) && node.type.includes(type))
}

function isFilterable(node: JsonNode | undefined): boolean {
  return Boolean(node) && (Array.isArray(node!.enum) || (isType(node!, 'string') && typeof node!.maxLength === 'number'))
}

function topField(root: JsonNode, field: string): JsonNode | undefined {
  const properties = root.properties as Record<string, JsonNode> | undefined
  const node = properties && Object.hasOwn(properties, field) ? properties[field] : undefined
  // A field may be optional or nullable: take its non-null alternative.
  return alternatives(root, node).find(option => !isType(option, 'null'))
}

/** A pattern with no unbounded quantifier matches only bounded strings. */
function finitePattern(pattern: unknown): boolean {
  return typeof pattern === 'string' && !/(?<!\\)[*+]|\{\d+,\}/.test(pattern)
}

/** The first unbounded or loose part of a JSON Schema, or `null`. */
function unbounded(root: JsonNode, node: JsonNode | undefined, seen: Set<JsonNode>): string | null {
  if (!node || seen.has(node)) return null
  seen.add(node)
  const resolved = deref(root, node)
  if (!resolved) return 'an unresolvable reference'
  if (resolved !== node) return unbounded(root, resolved, seen)
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    for (const option of (node[key] as JsonNode[] | undefined) ?? []) {
      const problem = unbounded(root, option, seen)
      if (problem) return problem
    }
  }
  if (isType(node, 'string') && node.enum === undefined && node.const === undefined && typeof node.maxLength !== 'number'
    && !['date', 'date-time', 'uuid', 'email'].includes(node.format as string) && !finitePattern(node.pattern)) return 'an unbounded string'
  if (isType(node, 'array')) {
    if (typeof node.maxItems !== 'number') return 'an unbounded array'
    const problem = unbounded(root, node.items as JsonNode | undefined, seen)
    if (problem) return problem
  }
  if (isType(node, 'object') || node.properties) {
    if (node.additionalProperties !== false) return 'an object that is not strict, or a record'
    for (const property of Object.values((node.properties as Record<string, JsonNode> | undefined) ?? {})) {
      const problem = unbounded(root, property, seen)
      if (problem) return problem
    }
  }
  return null
}

/** The permission for an action on a type: `publisher.<type>.<action>`. */
export function publisherPermission(type: string, action: PublisherPermissionAction): string {
  return `publisher.${type}.${action}`
}

/** Every permission the registry derives, with its risk, for the host to add to Authorisation's catalogue (§10). */
export function publisherPermissions(registry: PublisherRegistry): readonly { permission: string, risk: PublisherRisk, type: string, action: PublisherPermissionAction }[] {
  return [...registry.values()].flatMap(declaration => PUBLISHER_PERMISSION_ACTIONS.map(action => ({
    permission: publisherPermission(declaration.type, action),
    risk: declaration.risks[action],
    type: declaration.type,
    action,
  })))
}
