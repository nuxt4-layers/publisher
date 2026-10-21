import { createHash } from 'node:crypto'
import type {
  PublisherContent,
  PublisherDocument,
  PublisherEvent,
  PublisherEventType,
  PublisherPermissionAction,
  PublisherRegistry,
  PublisherSubject,
  PublisherTypeDeclaration,
} from '../../shared/contracts'
import {
  canonicalJson,
  meetsStepUp,
  publisherContentSchema,
  publisherDocumentSchema,
  publisherEventSchema,
  publisherPermission,
  siteIdSchema,
  PublisherCompositionError,
  PublisherFailure,
} from '../../shared/contracts'
import { checkPublisherMarkdown } from '../../markdown/dialect'
import { quoteSchema } from '../database/migrations'
import {
  usePublisherAccessDecision,
  usePublisherAssetResolver,
  usePublisherClock,
  usePublisherDatabase,
  usePublisherRegistry,
} from '../utils/publisher-composition'
import { uuidv7 } from './ids'

/**
 * PRIVATE. Storage, content checks and authorisation shared by the server
 * functions. SQL is parameterised; every row is parsed with the contract's
 * schemas before it leaves the layer.
 */

export interface Client {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[], rowCount: number | null }>
  release(): void
}

export interface DocumentRow {
  id: string
  site_id: string
  type: string
  status: PublisherDocument['status']
  latest_version: number
  published_version: number | null
  review_version: number | null
  approval_id: string | null
  review_requester: string | null
  moderation: PublisherDocument['moderation']
  publish_at: Date | null
  unpublish_at: Date | null
  created_at: Date
  updated_at: Date
  published_at: Date | null
  path: string | null
  latest_path: string | null
}

export interface VersionRow {
  document_id: string
  version: number
  content: PublisherContent
  digest: string
  saved_at: Date
  saved_by: string | null
  restored_from: number | null
  subject_id: string | null
}

/** Every failure that is not already a contract failure leaves as `unavailable`: the layer fails closed. */
export async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  }
  catch (error) {
    if (error instanceof PublisherFailure || error instanceof PublisherCompositionError) throw error
    throw new PublisherFailure('unavailable', 'failed')
  }
}

export function schemaName(): string {
  return quoteSchema(usePublisherDatabase().schema)
}

export function now(): Date {
  return usePublisherClock().now()
}

const checkedTypes = new WeakMap<PublisherRegistry, WeakSet<object>>()

/**
 * Refuses to serve while the database holds documents of a type the host
 * no longer registers: they would otherwise be served as something else.
 */
export async function ensureRegistered(client: Client): Promise<void> {
  const registry = usePublisherRegistry()
  const { pool } = usePublisherDatabase()
  if (checkedTypes.get(registry)?.has(pool)) return
  const { rows } = await client.query<{ type: string }>(`select distinct "type" from ${schemaName()}."document"`)
  const missing = rows.map(row => row.type).filter(type => !registry.has(type)).sort()
  if (missing.length > 0) throw new PublisherCompositionError('PublisherDocumentTypes', `The database holds documents of unregistered types: ${missing.join(', ')}.`)
  const pools = checkedTypes.get(registry) ?? new WeakSet<object>()
  pools.add(pool)
  checkedTypes.set(registry, pools)
}

/** Runs with a client, checking the stored types first. */
export async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const { pool } = usePublisherDatabase()
  return guarded(async () => {
    const client = await pool.connect() as Client
    try {
      await ensureRegistered(client)
      return await run(client)
    }
    finally {
      client.release()
    }
  })
}

/** Runs in one transaction: the change and its events commit together or not at all. */
export async function inTransaction<T>(run: (client: Client) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('begin')
    try {
      const result = await run(client)
      await client.query('commit')
      return result
    }
    catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    }
  })
}

export function declarationOf(type: string): PublisherTypeDeclaration {
  const declaration = usePublisherRegistry().get(type)
  if (!declaration) throw new PublisherFailure('validation-failed', 'unknown-type')
  return declaration
}

/** A site named by the host, checked: anything else is `validation-failed` (§3.4). */
export function siteOf(siteId: unknown): string {
  const parsed = siteIdSchema.safeParse(siteId)
  if (!parsed.success) throw new PublisherFailure('validation-failed', 'not-a-site')
  return parsed.data
}

/** Whether the subject holds the type's permission on the site now. A failing port is `unavailable`. */
export async function allows(subject: PublisherSubject | null | undefined, siteId: string, type: string, action: PublisherPermissionAction, documentId: string | null): Promise<boolean> {
  if (!subject) return false
  const access = usePublisherAccessDecision()
  try {
    return await access.allows({ identityId: subject.identityId, permission: publisherPermission(type, action), siteId, type, documentId, consistency: 'strong' }) === true
  }
  catch {
    throw new PublisherFailure('unavailable', 'access-decision-failed')
  }
}

/** Refuses without the permission (`forbidden`), then without the step-up its risk needs. */
export async function authorise(subject: PublisherSubject, siteId: string, type: string, action: PublisherPermissionAction, documentId: string | null): Promise<void> {
  if (!await allows(subject, siteId, type, action, documentId)) throw new PublisherFailure('forbidden')
  if (!meetsStepUp(declarationOf(type).risks[action], subject.assurance, now())) throw new PublisherFailure('insufficient-assurance')
}

function issueCode(issues: readonly { message: string }[]): string | undefined {
  return issues.map(issue => issue.message).find(message => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(message) && message.length <= 64)
}

/** Every string a Markdown field path leads to in a document's fields. */
export function markdownValues(fields: unknown, path: string): string[] {
  let values: unknown[] = [fields]
  for (const segment of path.split('.')) {
    const array = segment.endsWith('[]')
    const name = array ? segment.slice(0, -2) : segment
    values = values.flatMap(value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, name) ? [(value as Record<string, unknown>)[name]] : [])
    if (array) values = values.flatMap(value => Array.isArray(value) ? value : [])
  }
  return values.filter((value): value is string => typeof value === 'string')
}

/** The documents and assets a version's Markdown names. */
export function namedBy(declaration: PublisherTypeDeclaration, content: PublisherContent): { documentIds: string[], assetIds: string[], problems: string[] } {
  const documentIds = new Set<string>()
  const assetIds = new Set<string>()
  const problems = new Set<string>()
  for (const path of declaration.markdownFields) {
    for (const source of markdownValues(content.fields, path)) {
      const checked = checkPublisherMarkdown(source)
      checked.documentIds.forEach(id => documentIds.add(id))
      checked.assetIds.forEach(id => assetIds.add(id))
      checked.problems.forEach(problem => problems.add(problem))
    }
  }
  return { documentIds: [...documentIds], assetIds: [...assetIds], problems: [...problems] }
}

/** Parses one version's content against the envelope and the type, as every save and import does (§6.4). */
export function parseContent(declaration: PublisherTypeDeclaration, input: unknown): PublisherContent {
  const envelope = publisherContentSchema.safeParse(input)
  if (!envelope.success) throw new PublisherFailure('validation-failed', issueCode(envelope.error.issues))
  const fields = declaration.fields.safeParse(envelope.data.fields)
  if (!fields.success) throw new PublisherFailure('validation-failed', issueCode(fields.error.issues))
  const content: PublisherContent = { ...envelope.data, fields: fields.data as Record<string, unknown> }
  if (declaration.address.kind === 'none') {
    if (content.slug !== null || content.addressDate !== null) throw new PublisherFailure('validation-failed', 'address-not-allowed')
  }
  else {
    if (content.slug === null) throw new PublisherFailure('validation-failed', 'address-required')
    if (declaration.address.pattern === 'slug' && content.addressDate !== null) throw new PublisherFailure('validation-failed', 'address-not-allowed')
  }
  const { problems, assetIds } = namedBy(declaration, content)
  if (problems.length > 0) throw new PublisherFailure('validation-failed', problems[0])
  if (assetIds.length > 0 && !usePublisherAssetResolver()) throw new PublisherFailure('validation-failed', 'images-unavailable')
  return content
}

/** The address a version's content gives, or `null` for types without one (§3.2). */
export function pathOf(declaration: PublisherTypeDeclaration, content: PublisherContent, firstPublished: Date | null): string | null {
  const rule = declaration.address
  if (rule.kind === 'none' || content.slug === null) return null
  const parts = [rule.base]
  if (rule.pattern === 'date-slug') {
    const date = content.addressDate ?? (firstPublished ?? now()).toISOString().slice(0, 10)
    parts.push(...date.split('-'))
  }
  if (content.slug !== '') parts.push(content.slug)
  const path = parts.join('/')
  return path === '' ? '/' : path.startsWith('/') ? path : `/${path}`
}

export function digestOf(documentId: string, type: string, version: number, content: PublisherContent): string {
  return createHash('sha256').update(canonicalJson({ id: documentId, type, version, content })).digest('hex')
}

/** The person a personal-data type's version names, for export and erasure (§9). */
export function subjectOf(declaration: PublisherTypeDeclaration, content: PublisherContent): string | null {
  if (!declaration.personalData) return null
  const value = content.fields[declaration.personalData.subjectField]
  return typeof value === 'string' ? value : null
}

/** Without the subject and consent fields, which readers never receive (§8.4). */
export function readerFields(declaration: PublisherTypeDeclaration, fields: Record<string, unknown>): Record<string, unknown> {
  if (!declaration.personalData) return fields
  const { [declaration.personalData.subjectField]: _subject, [declaration.personalData.consentField]: _consent, ...rest } = fields
  return rest
}

const iso = (value: Date | null) => value === null ? null : new Date(value).toISOString()

/** A document in the envelope, at one version, parsed with the contract's schema. */
export function toDocument(row: DocumentRow, version: VersionRow, options: { forReaders?: boolean } = {}): PublisherDocument {
  const declaration = declarationOf(row.type)
  const content = version.content
  const live = row.status === 'published' && version.version === row.published_version
  return publisherDocumentSchema.parse({
    id: row.id,
    siteId: row.site_id,
    type: row.type,
    locale: content.locale,
    title: content.title,
    summary: content.summary ?? null,
    fields: options.forReaders ? readerFields(declaration, content.fields) : content.fields,
    slug: content.slug ?? null,
    addressDate: content.addressDate ?? null,
    authors: content.authors ?? [],
    path: live ? row.path : pathOf(declaration, content, row.published_at),
    status: row.status,
    version: version.version,
    latestVersion: row.latest_version,
    publishedVersion: row.published_version,
    reviewVersion: row.review_version,
    moderation: row.moderation,
    publishAt: iso(row.publish_at),
    unpublishAt: iso(row.unpublish_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: iso(row.published_at),
  })
}

/** A document on the site, or `null`: one on another site is as missing as none. */
export async function loadDocument(client: Client, siteId: string, documentId: string, lock = false): Promise<DocumentRow | null> {
  const { rows } = await client.query<DocumentRow>(`select * from ${schemaName()}."document" where "id" = $1 and "site_id" = $2${lock ? ' for update' : ''}`, [documentId, siteId])
  return rows[0] ?? null
}

export async function loadVersion(client: Client, documentId: string, version: number): Promise<VersionRow | null> {
  const { rows } = await client.query<VersionRow>(`select * from ${schemaName()}."version" where "document_id" = $1 and "version" = $2`, [documentId, version])
  return rows[0] ?? null
}

/** Writes an event to the outbox, in the caller's transaction. Identifiers, codes and times only. */
export async function emit<Type extends PublisherEventType>(client: Client, type: Type, data: Extract<PublisherEvent, { type: Type }>['data'], context: { correlationId: string, actorId: string | null }): Promise<void> {
  const at = now()
  const event = publisherEventSchema.parse({ eventId: uuidv7(at), occurredAt: at.toISOString(), correlationId: context.correlationId, actorId: context.actorId, type, data })
  await client.query(`insert into ${schemaName()}."outbox" ("event", "created_at") values ($1::jsonb, $2)`, [JSON.stringify(event), at])
}

/** Recomputes a document's links from its newest and its published version (§7.3). */
export async function refreshLinks(client: Client, row: Pick<DocumentRow, 'id' | 'type' | 'latest_version' | 'published_version'>): Promise<void> {
  const declaration = declarationOf(row.type)
  const versions = [...new Set([row.latest_version, row.published_version].filter((version): version is number => version !== null))]
  const targets = new Set<string>()
  for (const number of versions) {
    const version = await loadVersion(client, row.id, number)
    if (version) namedBy(declaration, version.content).documentIds.forEach(id => targets.add(id))
  }
  targets.delete(row.id)
  await client.query(`delete from ${schemaName()}."link" where "from_id" = $1`, [row.id])
  if (targets.size > 0) await client.query(`insert into ${schemaName()}."link" ("from_id", "to_id") select $1, unnest($2::text[])`, [row.id, [...targets]])
}

/** How many other documents link to this one now. */
export async function countBacklinks(client: Client, siteId: string, documentId: string): Promise<number> {
  const { rows } = await client.query<{ count: number }>(`select count(*)::int as "count" from ${schemaName()}."link" l join ${schemaName()}."document" d on d."id" = l."from_id" where l."to_id" = $1 and l."from_id" <> $1 and d."site_id" = $2`, [documentId, siteId])
  return rows[0]!.count
}
