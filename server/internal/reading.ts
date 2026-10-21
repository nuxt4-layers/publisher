import type {
  PublisherBacklink,
  PublisherBundle,
  PublisherBundleDocument,
  PublisherDocument,
  PublisherFeedFormat,
  PublisherListing,
  PublisherListingQuery,
  PublisherPersonExport,
  PublisherRendered,
  PublisherResolution,
  PublisherSitemapEntry,
  PublisherStatus,
  PublisherSubject,
  PublisherVersion,
} from '../../shared/contracts'
import {
  identifierSchema,
  PUBLISHER_BUNDLE_FORMAT,
  publisherBacklinkSchema,
  publisherBundleSchema,
  publisherEventSchema,
  PublisherFailure,
  publisherListingQuerySchema,
  publisherPersonExportSchema,
  publisherRenderedSchema,
  publisherResolutionSchema,
  publisherSitemapEntrySchema,
  publisherVersionSchema,
  sitePathSchema,
} from '../../shared/contracts'
import { usePublisherAssetResolver, usePublisherDatabase, usePublisherEventSink, usePublisherRegistry, usePublisherTitleTemplate } from '../utils/publisher-composition'
import type { Client, DocumentRow, VersionRow } from './store'
import {
  allows,
  declarationOf,
  digestOf,
  emit,
  guarded,
  inTransaction,
  loadDocument,
  loadVersion,
  markdownValues,
  namedBy,
  now,
  parseContent,
  pathOf,
  refreshLinks,
  schemaName,
  subjectOf,
  toDocument,
  withClient,
} from './store'

/** PRIVATE. Reading, administration lists, feeds, the relay, export and import (docs/contracts.md §7, §8, §9, §16). */

// --- Administration --------------------------------------------------------

async function viewable(client: Client, subject: PublisherSubject, documentId: string): Promise<DocumentRow> {
  const row = identifierSchema.safeParse(documentId).success ? await loadDocument(client, documentId) : null
  if (!row) throw new PublisherFailure('forbidden')
  if (!await allows(subject, row.type, 'view-draft', row.id)) throw new PublisherFailure('forbidden')
  return row
}

export async function getDocument(input: { subject: PublisherSubject, documentId: string, version?: number }): Promise<PublisherDocument> {
  return withClient(async (client) => {
    const row = await viewable(client, input.subject, input.documentId)
    const version = await loadVersion(client, row.id, input.version ?? row.latest_version)
    if (!version) throw new PublisherFailure('validation-failed', 'unknown-version')
    return toDocument(row, version)
  })
}

async function listLatest(client: Client, where: string, values: unknown[], limit: number, offset: number): Promise<PublisherListing> {
  const { rows } = await client.query<DocumentRow & { content: VersionRow['content'], version: number, total: number }>(
    `select d.*, v."content", v."version", count(*) over ()::int as "total" from ${schemaName()}."document" d join ${schemaName()}."version" v on v."document_id" = d."id" and v."version" = d."latest_version" where ${where} order by d."updated_at" desc, d."id" limit ${limit} offset ${offset}`,
    values,
  )
  return { documents: rows.map(row => toDocument(row, row as unknown as VersionRow)), total: rows[0]?.total ?? 0 }
}

function paging(input: { limit?: number, offset?: number }): { limit: number, offset: number } {
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new PublisherFailure('validation-failed')
  return { limit, offset }
}

export async function listDocuments(input: { subject: PublisherSubject, type: string, search?: string, status?: PublisherStatus, limit?: number, offset?: number }): Promise<PublisherListing> {
  declarationOf(input.type)
  const { limit, offset } = paging(input)
  return withClient(async (client) => {
    if (!await allows(input.subject, input.type, 'view-draft', null)) throw new PublisherFailure('forbidden')
    const values: unknown[] = [input.type]
    let where = 'd."type" = $1'
    if (input.status) where += ` and d."status" = $${values.push(input.status)}`
    if (input.search) where += ` and v."content"->>'title' ilike $${values.push(`%${input.search.slice(0, 100).replace(/[\\%_]/g, character => `\\${character}`)}%`)}`
    return listLatest(client, where, values, limit, offset)
  })
}

export async function listModerationQueue(input: { subject: PublisherSubject, type?: string }): Promise<PublisherListing> {
  return withClient(async (client) => {
    const types: string[] = []
    for (const declaration of usePublisherRegistry().values()) {
      if (!declaration.lifecycle.moderation || (input.type && input.type !== declaration.type)) continue
      if (await allows(input.subject, declaration.type, 'moderate', null)) types.push(declaration.type)
    }
    if (types.length === 0) return { documents: [], total: 0 }
    return listLatest(client, `d."type" = any($1::text[]) and d."moderation" = 'pending' and d."status" = 'in-review'`, [types], 100, 0)
  })
}

export async function listHistory(input: { subject: PublisherSubject, documentId: string }): Promise<PublisherVersion[]> {
  return withClient(async (client) => {
    const row = await viewable(client, input.subject, input.documentId)
    const { rows } = await client.query<VersionRow>(`select * from ${schemaName()}."version" where "document_id" = $1 order by "version" desc`, [row.id])
    return rows.map(version => publisherVersionSchema.parse({
      documentId: version.document_id,
      version: version.version,
      savedAt: new Date(version.saved_at).toISOString(),
      savedBy: version.saved_by,
      restoredFrom: version.restored_from,
      digest: version.digest,
    }))
  })
}

export async function listBacklinks(input: { subject: PublisherSubject, documentId: string }): Promise<PublisherBacklink[]> {
  return withClient(async (client) => {
    const row = await viewable(client, input.subject, input.documentId)
    const { rows } = await client.query<{ id: string, type: string, status: PublisherStatus, title: string }>(
      `select d."id", d."type", d."status", v."content"->>'title' as "title" from ${schemaName()}."link" l join ${schemaName()}."document" d on d."id" = l."from_id" join ${schemaName()}."version" v on v."document_id" = d."id" and v."version" = d."latest_version" where l."to_id" = $1 and l."from_id" <> $1 order by d."id"`,
      [row.id],
    )
    const mayView = new Map<string, boolean>()
    const backlinks: PublisherBacklink[] = []
    for (const link of rows) {
      if (!mayView.has(link.type)) mayView.set(link.type, await allows(input.subject, link.type, 'view-draft', null))
      backlinks.push(publisherBacklinkSchema.parse({ documentId: link.id, type: link.type, status: link.status, title: mayView.get(link.type) ? link.title : null }))
    }
    return backlinks
  })
}

// --- Readers ---------------------------------------------------------------

interface Viewing {
  viewer?: PublisherSubject | null
  preview?: boolean
}

async function render(client: Client, row: DocumentRow, version: VersionRow, preview: boolean): Promise<PublisherRendered> {
  const declaration = declarationOf(row.type)
  const document = toDocument(row, version, { forReaders: true })
  const { documentIds, assetIds } = namedBy(declaration, version.content)
  const documents: Record<string, string | null> = {}
  if (documentIds.length > 0) {
    const { rows } = await client.query<{ id: string, path: string | null }>(`select "id", "path" from ${schemaName()}."document" where "id" = any($1::text[]) and "status" = 'published'`, [documentIds])
    for (const id of documentIds) documents[id] = rows.find(target => target.id === id)?.path ?? null
  }
  const assets: PublisherRendered['links']['assets'] = {}
  if (assetIds.length > 0) {
    const resolver = usePublisherAssetResolver()
    let answer: Awaited<ReturnType<NonNullable<typeof resolver>['resolve']>> = {}
    if (resolver) {
      try {
        answer = await resolver.resolve({ assetIds })
      }
      catch {
        throw new PublisherFailure('unavailable', 'asset-resolver-failed')
      }
    }
    for (const id of assetIds) {
      const asset = answer[id]
      const safe = asset && typeof asset.url === 'string' && (sitePathSchema.safeParse(asset.url).success || /^https:\/\/[^\s"<>]+$/.test(asset.url))
      assets[id] = safe ? { url: asset.url, ...(Number.isInteger(asset.width) && asset.width! > 0 ? { width: asset.width } : {}), ...(Number.isInteger(asset.height) && asset.height! > 0 ? { height: asset.height } : {}) } : null
    }
  }
  const template = usePublisherTitleTemplate()
  let title = document.title
  if (template) {
    try {
      title = String(await template.format({ title: document.title, type: row.type, locale: document.locale }))
    }
    catch {
      throw new PublisherFailure('unavailable', 'title-template-failed')
    }
  }
  return publisherRenderedSchema.parse({
    document,
    links: { documents, assets },
    markdown: declaration.markdownFields.flatMap(path => markdownValues(document.fields, path)),
    head: {
      title,
      description: document.summary,
      canonicalPath: document.path,
      locale: document.locale,
      publishedAt: document.publishedAt,
      modifiedAt: document.updatedAt,
    },
    preview,
  })
}

async function readable(client: Client, rows: DocumentRow[], viewing: Viewing, matches: (row: DocumentRow) => { published: boolean, latest: boolean }): Promise<PublisherRendered | null> {
  if (viewing.preview && viewing.viewer) {
    for (const row of rows) {
      if (!matches(row).latest || row.status === 'archived') continue
      if (await allows(viewing.viewer, row.type, 'view-draft', row.id)) return render(client, row, (await loadVersion(client, row.id, row.latest_version))!, true)
    }
  }
  const live = rows.find(row => row.status === 'published' && row.published_version !== null && matches(row).published)
  return live ? render(client, live, (await loadVersion(client, live.id, live.published_version!))!, false) : null
}

export async function getPublished(input: Viewing & ({ path: string } | { documentId: string })): Promise<PublisherRendered | null> {
  return withClient(client => findPublished(client, input))
}

async function findPublished(client: Client, input: Viewing & ({ path: string } | { documentId: string })): Promise<PublisherRendered | null> {
  if ('documentId' in input) {
    const row = identifierSchema.safeParse(input.documentId).success ? await loadDocument(client, input.documentId) : null
    return row ? readable(client, [row], input, () => ({ published: true, latest: true })) : null
  }
  if (!sitePathSchema.safeParse(input.path).success) return null
  const { rows } = await client.query<DocumentRow>(`select * from ${schemaName()}."document" where "path" = $1 or "latest_path" = $1 order by "path" is null, "id"`, [input.path])
  return readable(client, rows, input, row => ({ published: row.path === input.path, latest: row.latest_path === input.path }))
}

export async function resolvePath(input: Viewing & { path: string }): Promise<PublisherResolution> {
  return withClient(async (client) => {
    if (typeof input.path !== 'string' || !sitePathSchema.safeParse(input.path).success) return { kind: 'none' }
    const rendered = await findPublished(client, input)
    if (rendered) return publisherResolutionSchema.parse({ kind: 'document', rendered })
    const target = async (path: string) => {
      const { rows } = await client.query<{ path: string }>(
        `select d."path" from ${schemaName()}."redirect" r join ${schemaName()}."document" d on d."id" = r."document_id" where r."path" = $1 and d."status" = 'published' and d."path" is not null`,
        [path],
      )
      return rows[0]?.path ?? null
    }
    const redirected = await target(input.path)
    if (redirected && redirected !== input.path) return { kind: 'redirect', to: redirected, status: 301 }
    if (input.path.length > 1 && input.path.endsWith('/')) {
      const bare = input.path.replace(/\/+$/, '')
      if (bare && (await findPublished(client, { path: bare }) || await target(bare))) return { kind: 'redirect', to: (await target(bare)) ?? bare, status: 301 }
    }
    return { kind: 'none' }
  })
}

function listable(type: string) {
  const declaration = usePublisherRegistry().get(type)
  if (!declaration || !declaration.listing.listable) throw new PublisherFailure('validation-failed', 'unknown-type')
  return declaration
}

const ORDER = {
  'published-desc': 'd."published_at" desc, d."id" desc',
  'published-asc': 'd."published_at" asc, d."id" asc',
  'title-asc': 'v."content"->>\'title\' asc, d."id" asc',
  'updated-desc': 'd."updated_at" desc, d."id" desc',
} as const

export async function listPublished(query: PublisherListingQuery): Promise<PublisherListing> {
  const parsed = publisherListingQuerySchema.safeParse(query)
  if (!parsed.success) throw new PublisherFailure('validation-failed')
  const { type, locale, filters, order, limit, offset } = parsed.data
  const declaration = listable(type)
  for (const field of Object.keys(filters)) if (!declaration.listing.filterable.includes(field)) throw new PublisherFailure('validation-failed', 'unknown-filter')
  return withClient(async (client) => {
    const values: unknown[] = [type]
    let where = `d."type" = $1 and d."status" = 'published'`
    if (locale) where += ` and v."content"->>'locale' = $${values.push(locale)}`
    for (const [field, value] of Object.entries(filters)) {
      const name = values.push(field)
      const text = values.push(value)
      where += ` and (v."content"->'fields'->$${name} = to_jsonb($${text}::text) or v."content"->'fields'->$${name} @> jsonb_build_array($${text}::text))`
    }
    const { rows } = await client.query<DocumentRow & { content: VersionRow['content'], version: number, total: number }>(
      `select d.*, v."content", v."version", count(*) over ()::int as "total" from ${schemaName()}."document" d join ${schemaName()}."version" v on v."document_id" = d."id" and v."version" = d."published_version" where ${where} order by ${ORDER[order ?? declaration.listing.order]} limit ${limit} offset ${offset}`,
      values,
    )
    return { documents: rows.map(row => toDocument(row, row as unknown as VersionRow, { forReaders: true })), total: rows[0]?.total ?? 0 }
  })
}

const escapeXml = (value: string) => value.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&apos;' })[character]!)

function originOf(origin: string): string {
  try {
    const url = new URL(origin)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash) return url.origin
  }
  catch {}
  throw new PublisherFailure('validation-failed', 'not-an-origin')
}

export async function getFeed(input: { type: string, format: PublisherFeedFormat, origin: string, limit?: number }): Promise<string> {
  const declaration = listable(input.type)
  const origin = originOf(input.origin)
  if (input.format !== 'rss' && input.format !== 'atom') throw new PublisherFailure('validation-failed')
  const { documents } = await listPublished({ type: input.type, limit: Math.min(input.limit ?? 20, 100) })
  const template = usePublisherTitleTemplate()
  let title = declaration.label.many
  if (template) {
    try {
      title = String(await template.format({ title: declaration.label.many, type: declaration.type, locale: documents[0]?.locale ?? '' }))
    }
    catch {
      throw new PublisherFailure('unavailable', 'title-template-failed')
    }
  }
  const link = (document: PublisherDocument) => document.path ? `${origin}${document.path}` : null
  const updated = documents[0]?.updatedAt ?? now().toISOString()
  if (input.format === 'rss') {
    const items = documents.map(document => [
      '<item>',
      `<title>${escapeXml(document.title)}</title>`,
      link(document) ? `<link>${escapeXml(link(document)!)}</link>` : '',
      `<guid isPermaLink="false">urn:uuid:${document.id}</guid>`,
      document.publishedAt ? `<pubDate>${new Date(document.publishedAt).toUTCString()}</pubDate>` : '',
      document.summary ? `<description>${escapeXml(document.summary)}</description>` : '',
      '</item>',
    ].join(''))
    return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeXml(title)}</title><link>${escapeXml(origin)}/</link><description>${escapeXml(title)}</description><lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>${items.join('')}</channel></rss>\n`
  }
  const entries = documents.map(document => [
    '<entry>',
    `<title>${escapeXml(document.title)}</title>`,
    `<id>urn:uuid:${document.id}</id>`,
    link(document) ? `<link href="${escapeXml(link(document)!)}"/>` : '',
    `<updated>${document.updatedAt}</updated>`,
    document.publishedAt ? `<published>${document.publishedAt}</published>` : '',
    document.summary ? `<summary>${escapeXml(document.summary)}</summary>` : '',
    '</entry>',
  ].join(''))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><title>${escapeXml(title)}</title><id>${escapeXml(`${origin}/#${declaration.type}`)}</id><link href="${escapeXml(origin)}/"/><updated>${updated}</updated>${entries.join('')}</feed>\n`
}

export async function listSitemap(): Promise<PublisherSitemapEntry[]> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ path: string, updated_at: Date, type: string }>(`select "path", "updated_at", "type" from ${schemaName()}."document" where "status" = 'published' and "path" is not null order by "path"`)
    return rows.map(row => publisherSitemapEntrySchema.parse({ path: row.path, lastModified: new Date(row.updated_at).toISOString(), type: row.type }))
  })
}

// --- Relay -------------------------------------------------------------------

export async function relayOutbox(input: { limit?: number }): Promise<number> {
  const sink = usePublisherEventSink()
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 1000)
  const { pool } = usePublisherDatabase()
  const client = await guarded(async () => pool.connect() as Promise<Client>)
  try {
    await client.query('begin')
    const { rows } = await client.query<{ sequence: string, event: unknown }>(`select "sequence", "event" from ${schemaName()}."outbox" where "published_at" is null order by "sequence" limit ${limit} for update skip locked`)
    if (rows.length > 0) {
      await sink.publish(rows.map(row => publisherEventSchema.parse(row.event)))
      await client.query(`update ${schemaName()}."outbox" set "published_at" = $2 where "sequence" = any($1::bigint[])`, [rows.map(row => row.sequence), now()])
    }
    await client.query('commit')
    return rows.length
  }
  catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  }
  finally {
    client.release()
  }
}

// --- Export, import and personal data ---------------------------------------

const iso = (value: Date | null) => value === null ? null : new Date(value).toISOString()

async function bundleDocuments(client: Client, where: string, values: unknown[]): Promise<PublisherBundleDocument[]> {
  const { rows } = await client.query<DocumentRow>(`select * from ${schemaName()}."document" where ${where} order by "created_at", "id"`, values)
  const documents: PublisherBundleDocument[] = []
  for (const row of rows) {
    const { rows: versions } = await client.query<VersionRow>(`select * from ${schemaName()}."version" where "document_id" = $1 order by "version"`, [row.id])
    const { rows: redirects } = await client.query<{ path: string }>(`select "path" from ${schemaName()}."redirect" where "document_id" = $1 order by "path"`, [row.id])
    documents.push({
      id: row.id,
      type: row.type,
      status: row.status,
      publishedVersion: row.published_version,
      reviewVersion: row.review_version,
      moderation: row.moderation,
      publishAt: iso(row.publish_at),
      unpublishAt: iso(row.unpublish_at),
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
      publishedAt: iso(row.published_at),
      versions: versions.map(version => ({ version: version.version, savedAt: iso(version.saved_at)!, savedBy: version.saved_by, restoredFrom: version.restored_from, content: version.content })),
      redirects: redirects.map(redirect => redirect.path),
    })
  }
  return documents
}

export async function exportContent(input: { types?: readonly string[] }): Promise<PublisherBundle> {
  const types = input.types ? [...input.types] : [...usePublisherRegistry().keys()].sort()
  for (const type of types) declarationOf(type)
  return withClient(async client => publisherBundleSchema.parse({
    format: PUBLISHER_BUNDLE_FORMAT,
    version: 1,
    exportedAt: now().toISOString(),
    types,
    documents: await bundleDocuments(client, `"type" = any($1::text[])`, [types]),
  }))
}

export async function importContent(input: { bundle: unknown, correlationId: string }): Promise<{ documents: number, versions: number }> {
  const parsed = publisherBundleSchema.safeParse(input.bundle)
  if (!parsed.success) throw new PublisherFailure('validation-failed')
  const bundle = parsed.data
  // Every version is checked as a save would check it, before anything is written.
  const checked = bundle.documents.map((document) => {
    const declaration = declarationOf(document.type)
    const versions = document.versions.map(version => ({ ...version, content: parseContent(declaration, version.content) }))
    const numbers = versions.map(version => version.version)
    if (new Set(numbers).size !== numbers.length || (document.publishedVersion !== null && !numbers.includes(document.publishedVersion))) throw new PublisherFailure('validation-failed')
    return { document, declaration, versions }
  })
  if (new Set(bundle.documents.map(document => document.id)).size !== bundle.documents.length) throw new PublisherFailure('validation-failed')
  return inTransaction(async (client) => {
    const { rows: existing } = await client.query(`select 1 from ${schemaName()}."document" where "id" = any($1::text[]) limit 1`, [bundle.documents.map(document => document.id)])
    if (existing.length > 0) throw new PublisherFailure('conflict')
    let versionCount = 0
    for (const { document, declaration, versions } of checked) {
      const latest = versions.reduce((highest, version) => version.version > highest.version ? version : highest)
      const published = versions.find(version => version.version === document.publishedVersion) ?? null
      const publishedAt = document.publishedAt === null ? null : new Date(document.publishedAt)
      const path = document.status === 'published' && published ? pathOf(declaration, published.content, publishedAt) : null
      try {
        await client.query(
          `insert into ${schemaName()}."document" ("id", "type", "status", "latest_version", "published_version", "review_version", "moderation", "publish_at", "unpublish_at", "created_at", "updated_at", "published_at", "path", "latest_path") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [document.id, document.type, document.status, latest.version, document.publishedVersion, document.reviewVersion, document.moderation, document.publishAt, document.unpublishAt, document.createdAt, document.updatedAt, document.publishedAt, path, pathOf(declaration, latest.content, publishedAt)],
        )
      }
      catch (error) {
        const code = (error as { code?: string }).code
        if (code === '23505') throw new PublisherFailure('conflict', 'address-taken')
        if (code === '23514') throw new PublisherFailure('validation-failed')
        throw error
      }
      for (const version of versions) {
        await client.query(
          `insert into ${schemaName()}."version" ("document_id", "version", "content", "digest", "saved_at", "saved_by", "restored_from", "subject_id") values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`,
          [document.id, version.version, JSON.stringify(version.content), digestOf(document.id, document.type, version.version, version.content), version.savedAt, version.savedBy, version.restoredFrom, subjectOf(declaration, version.content)],
        )
        versionCount++
      }
      for (const redirect of document.redirects) {
        await client.query(`insert into ${schemaName()}."redirect" ("path", "document_id") values ($1, $2) on conflict ("path") do update set "document_id" = excluded."document_id"`, [redirect, document.id])
      }
    }
    for (const { document } of checked) {
      await refreshLinks(client, { id: document.id, type: document.type, latest_version: Math.max(...document.versions.map(version => version.version)), published_version: document.publishedVersion })
    }
    await emit(client, 'publisher.content-imported', { documents: checked.length, versions: versionCount }, { correlationId: input.correlationId, actorId: null })
    return { documents: checked.length, versions: versionCount }
  })
}

function personalTypes(): string[] {
  return [...usePublisherRegistry().values()].filter(declaration => declaration.personalData).map(declaration => declaration.type)
}

export async function exportPerson(input: { identityId: string }): Promise<PublisherPersonExport> {
  const identityId = identifierSchema.parse(input.identityId)
  return withClient(async client => publisherPersonExportSchema.parse({
    format: `${PUBLISHER_BUNDLE_FORMAT}.person`,
    version: 1,
    identityId,
    exportedAt: now().toISOString(),
    documents: await bundleDocuments(client, `"type" = any($1::text[]) and "id" in (select "document_id" from ${schemaName()}."version" where "subject_id" = $2)`, [personalTypes(), identityId]),
  }))
}

export async function erasePerson(input: { identityId: string, correlationId: string }): Promise<{ documents: number, versions: number }> {
  const identityId = identifierSchema.parse(input.identityId)
  return inTransaction(async (client) => {
    const { rows } = await client.query<DocumentRow & { versions: number }>(
      `select d.*, (select count(*)::int from ${schemaName()}."version" v where v."document_id" = d."id") as "versions" from ${schemaName()}."document" d where d."type" = any($1::text[]) and d."id" in (select "document_id" from ${schemaName()}."version" where "subject_id" = $2) for update`,
      [personalTypes(), identityId],
    )
    const context = { correlationId: input.correlationId, actorId: null }
    let versions = 0
    for (const row of rows) {
      if (row.status === 'published') await emit(client, 'publisher.document-unpublished', { documentId: row.id, type: row.type, reasonCode: 'erased' }, context)
      versions += row.versions
    }
    const ids = rows.map(row => row.id)
    if (ids.length > 0) {
      await client.query(`delete from ${schemaName()}."link" where "to_id" = any($1::text[])`, [ids])
      await client.query(`delete from ${schemaName()}."document" where "id" = any($1::text[])`, [ids])
    }
    await emit(client, 'publisher.person-erased', { identityId, documents: rows.length, versions }, context)
    return { documents: rows.length, versions }
  })
}

