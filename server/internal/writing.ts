import type { PublisherActionRequest, PublisherContent, PublisherDocument, PublisherSubject, PublisherTypeDeclaration } from '../../shared/contracts'
import { APPROVAL_FLOOR, PUBLISHER_TRANSITIONS, publisherActionRequestSchema, publisherPermission, PublisherFailure } from '../../shared/contracts'
import { usePublisherApproval, usePublisherRegistry } from '../utils/publisher-composition'
import type { Client, DocumentRow, VersionRow } from './store'
import {
  authorise,
  countBacklinks,
  declarationOf,
  digestOf,
  emit,
  inTransaction,
  loadDocument,
  loadVersion,
  now,
  parseContent,
  pathOf,
  refreshLinks,
  schemaName,
  siteOf,
  subjectOf,
  toDocument,
} from './store'
import { uuidv7 } from './ids'

/** PRIVATE. Creating documents and moving them through the state machine (docs/contracts.md §5). */

interface Context {
  correlationId: string
  actorId: string | null
}

async function insertVersion(client: Client, declaration: PublisherTypeDeclaration, documentId: string, version: number, content: PublisherContent, savedBy: string | null, restoredFrom: number | null, savedAt: Date): Promise<void> {
  await client.query(
    `insert into ${schemaName()}."version" ("document_id", "version", "content", "digest", "saved_at", "saved_by", "restored_from", "subject_id") values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`,
    [documentId, version, JSON.stringify(content), digestOf(documentId, declaration.type, version, content), savedAt, savedBy, restoredFrom, subjectOf(declaration, content)],
  )
}

async function latest(client: Client, siteId: string, documentId: string): Promise<PublisherDocument> {
  const row = (await loadDocument(client, siteId, documentId))!
  return toDocument(row, (await loadVersion(client, documentId, row.latest_version))!)
}

async function insertDocument(client: Client, siteId: string, declaration: PublisherTypeDeclaration, content: PublisherContent, status: 'draft' | 'in-review', moderation: 'pending' | null, savedBy: string | null): Promise<string> {
  const at = now()
  const documentId = uuidv7(at)
  await client.query(
    `insert into ${schemaName()}."document" ("id", "site_id", "type", "status", "latest_version", "moderation", "created_at", "updated_at", "latest_path") values ($1, $7, $2, $3, 1, $4, $5, $5, $6)`,
    [documentId, declaration.type, status, moderation, at, pathOf(declaration, content, null), siteId],
  )
  await insertVersion(client, declaration, documentId, 1, content, savedBy, null, at)
  await refreshLinks(client, { id: documentId, type: declaration.type, latest_version: 1, published_version: null })
  return documentId
}

export async function createDocument(input: { siteId: string, subject: PublisherSubject, correlationId: string, type: string, content: unknown }): Promise<PublisherDocument> {
  const siteId = siteOf(input.siteId)
  const declaration = declarationOf(input.type)
  return inTransaction(async (client) => {
    await authorise(input.subject, siteId, input.type, 'edit', null)
    const content = parseContent(declaration, input.content)
    const documentId = await insertDocument(client, siteId, declaration, content, 'draft', null, input.subject.identityId)
    await emit(client, 'publisher.document-created', { siteId, documentId, type: declaration.type, version: 1 }, { correlationId: input.correlationId, actorId: input.subject.identityId })
    return latest(client, siteId, documentId)
  })
}

export async function receiveSubmission(input: { siteId: string, correlationId: string, submitterId: string | null, type: string, content: unknown }): Promise<{ documentId: string }> {
  const siteId = siteOf(input.siteId)
  const declaration = declarationOf(input.type)
  if (!declaration.lifecycle.moderation) throw new PublisherFailure('validation-failed', 'not-moderated')
  return inTransaction(async (client) => {
    const content = parseContent(declaration, input.content)
    const documentId = await insertDocument(client, siteId, declaration, content, 'in-review', 'pending', input.submitterId)
    await emit(client, 'publisher.submission-received', { siteId, documentId, type: declaration.type }, { correlationId: input.correlationId, actorId: input.submitterId })
    return { documentId }
  })
}

/** Whether the approval port consents to publishing this version (§5.2). */
async function consented(row: DocumentRow, version: VersionRow, publisherId: string | null): Promise<boolean> {
  if (row.approval_id === null || row.review_version !== version.version) return false
  const declaration = declarationOf(row.type)
  let answer: Awaited<ReturnType<ReturnType<typeof usePublisherApproval>['decision']>>
  const approval = usePublisherApproval()
  try {
    answer = await approval.decision({ approvalId: row.approval_id })
  }
  catch {
    throw new PublisherFailure('unavailable', 'approval-failed')
  }
  if (answer.state !== 'approved' || answer.digest !== version.digest) return false
  const excluded = new Set([row.review_requester, publisherId].filter(Boolean))
  const approvers = new Set(answer.approverIds.filter(approver => !excluded.has(approver)))
  return approvers.size >= APPROVAL_FLOOR[declaration.risks.publish]
}

function consentRecorded(declaration: PublisherTypeDeclaration, content: PublisherContent): boolean {
  if (!declaration.personalData) return true
  const consent = content.fields[declaration.personalData.consentField]
  return consent !== undefined && consent !== null
}

/** Publishes the newest version now: the address, redirects, links and events (§5.1, §7.2). */
export async function publishNow(client: Client, row: DocumentRow, version: VersionRow, unpublishAt: Date | null, context: Context): Promise<void> {
  const declaration = declarationOf(row.type)
  const at = now()
  const firstPublished = row.published_at ?? at
  const path = pathOf(declaration, version.content, firstPublished)
  if (path !== null) {
    const { rows } = await client.query(`select 1 from ${schemaName()}."document" where "site_id" = $3 and "path" = $1 and "id" <> $2`, [path, row.id, row.site_id])
    if (rows.length > 0) throw new PublisherFailure('conflict', 'address-taken')
    await client.query(`delete from ${schemaName()}."redirect" where "site_id" = $2 and "path" = $1`, [path, row.site_id])
  }
  const moved = row.path !== null && row.path !== path
  if (moved) {
    await client.query(`insert into ${schemaName()}."redirect" ("site_id", "path", "document_id") values ($3, $1, $2) on conflict ("site_id", "path") do update set "document_id" = excluded."document_id"`, [row.path, row.id, row.site_id])
  }
  try {
    await client.query(
      `update ${schemaName()}."document" set "status" = 'published', "published_version" = $2, "published_at" = $3, "path" = $4, "review_version" = null, "approval_id" = null, "review_requester" = null, "publish_at" = null, "unpublish_at" = $5, "updated_at" = $6 where "id" = $1`,
      [row.id, version.version, firstPublished, path, unpublishAt, at],
    )
  }
  catch (error) {
    if ((error as { code?: string }).code === '23505') throw new PublisherFailure('conflict', 'address-taken')
    throw error
  }
  await refreshLinks(client, { ...row, published_version: version.version })
  if (moved) await emit(client, 'publisher.address-changed', { siteId: row.site_id, documentId: row.id, type: row.type, redirectRecorded: true }, context)
  await emit(client, 'publisher.document-published', { siteId: row.site_id, documentId: row.id, type: row.type, version: version.version, unpublishAt: unpublishAt?.toISOString() ?? null }, context)
}

async function takeDown(client: Client, row: DocumentRow, status: 'draft' | 'archived', reasonCode: 'unpublished' | 'archived' | 'expired', context: Context, extra: { moderation?: 'rejected' } = {}): Promise<void> {
  const wasPublic = row.status === 'published' || row.status === 'scheduled'
  await client.query(
    `update ${schemaName()}."document" set "status" = $2, "published_version" = null, "path" = null, "publish_at" = null, "unpublish_at" = null, "review_version" = null, "approval_id" = null, "review_requester" = null, "moderation" = coalesce($4, "moderation"), "updated_at" = $3 where "id" = $1`,
    [row.id, status, now(), extra.moderation ?? null],
  )
  await refreshLinks(client, { ...row, published_version: null })
  if (wasPublic || reasonCode !== 'unpublished') await emit(client, 'publisher.document-unpublished', { siteId: row.site_id, documentId: row.id, type: row.type, reasonCode }, context)
}

export async function transitionDocument(input: { siteId: string, subject: PublisherSubject, correlationId: string, documentId: string, request: unknown }): Promise<PublisherDocument> {
  const siteId = siteOf(input.siteId)
  const parsed = publisherActionRequestSchema.safeParse(input.request)
  if (!parsed.success) throw new PublisherFailure('validation-failed')
  const request: PublisherActionRequest = parsed.data
  const context: Context = { correlationId: input.correlationId, actorId: input.subject.identityId }
  return inTransaction(async (client) => {
    const row = await loadDocument(client, siteId, input.documentId, true)
    if (!row) throw new PublisherFailure('forbidden')
    const declaration = declarationOf(row.type)
    const transition = PUBLISHER_TRANSITIONS[request.action]
    await authorise(input.subject, siteId, row.type, transition.permission, row.id)
    if (request.expectedVersion !== row.latest_version) throw new PublisherFailure('conflict', 'version-stale')
    const allowed = transition.from[row.status]
    if (!allowed) throw new PublisherFailure('conflict', 'invalid-transition')
    const at = now()
    const newest = (await loadVersion(client, row.id, row.latest_version))!

    switch (request.action) {
      case 'save':
      case 'restore': {
        let content: PublisherContent
        let restoredFrom: number | null = null
        if (request.action === 'restore') {
          const earlier = await loadVersion(client, row.id, request.version)
          if (!earlier) throw new PublisherFailure('validation-failed', 'unknown-version')
          content = parseContent(declaration, earlier.content)
          restoredFrom = request.version
        }
        else {
          content = parseContent(declaration, request.content)
        }
        const version = row.latest_version + 1
        await insertVersion(client, declaration, row.id, version, content, input.subject.identityId, restoredFrom, at)
        const status = row.status === 'published' ? 'published' : 'draft'
        await client.query(
          `update ${schemaName()}."document" set "status" = $2, "latest_version" = $3, "latest_path" = $4, "review_version" = null, "approval_id" = null, "review_requester" = null, "publish_at" = case when $2 = 'published' then "publish_at" else null end, "unpublish_at" = case when $2 = 'published' then "unpublish_at" else null end, "updated_at" = $5 where "id" = $1`,
          [row.id, status, version, pathOf(declaration, content, row.published_at), at],
        )
        await refreshLinks(client, { ...row, latest_version: version })
        await emit(client, 'publisher.document-saved', { siteId: row.site_id, documentId: row.id, type: row.type, version, restoredFrom }, context)
        break
      }
      case 'submit': {
        if (!declaration.lifecycle.approval || (row.status === 'published' && row.latest_version === row.published_version)) throw new PublisherFailure('conflict', 'invalid-transition')
        const approval = usePublisherApproval()
        let approvalId: string
        try {
          ({ approvalId } = await approval.request({
            siteId,
            documentId: row.id,
            type: row.type,
            version: newest.version,
            digest: newest.digest,
            permission: publisherPermission(row.type, 'publish'),
            risk: declaration.risks.publish,
            requiredApprovals: APPROVAL_FLOOR[declaration.risks.publish],
            requesterId: input.subject.identityId,
            correlationId: input.correlationId,
          }))
        }
        catch {
          throw new PublisherFailure('unavailable', 'approval-failed')
        }
        await client.query(
          `update ${schemaName()}."document" set "status" = $2, "review_version" = $3, "approval_id" = $4, "review_requester" = $5, "updated_at" = $6 where "id" = $1`,
          [row.id, allowed[0], newest.version, String(approvalId).slice(0, 200), input.subject.identityId, at],
        )
        await emit(client, 'publisher.review-requested', { siteId: row.site_id, documentId: row.id, type: row.type, version: newest.version, approvalId: String(approvalId).slice(0, 200) }, context)
        break
      }
      case 'withdraw': {
        await client.query(
          `update ${schemaName()}."document" set "status" = 'draft', "review_version" = null, "approval_id" = null, "review_requester" = null, "publish_at" = null, "unpublish_at" = null, "updated_at" = $2 where "id" = $1`,
          [row.id, at],
        )
        if (row.status === 'in-review') await emit(client, 'publisher.review-withdrawn', { siteId: row.site_id, documentId: row.id, type: row.type }, context)
        else await emit(client, 'publisher.document-unpublished', { siteId: row.site_id, documentId: row.id, type: row.type, reasonCode: 'unpublished' }, context)
        break
      }
      case 'publish': {
        if (row.moderation === 'pending') throw new PublisherFailure('conflict', 'not-moderated')
        if (row.status === 'published' && row.latest_version === row.published_version) throw new PublisherFailure('conflict', 'invalid-transition')
        const publishAt = request.publishAt === null ? null : new Date(request.publishAt)
        const unpublishAt = request.unpublishAt === null ? null : new Date(request.unpublishAt)
        if ((publishAt || unpublishAt) && !declaration.lifecycle.scheduling) throw new PublisherFailure('conflict', 'scheduling-disabled')
        const scheduled = publishAt !== null && publishAt.getTime() > at.getTime()
        if (unpublishAt && unpublishAt.getTime() <= Math.max(at.getTime(), publishAt?.getTime() ?? 0)) throw new PublisherFailure('validation-failed', 'schedule-out-of-order')
        if (scheduled && row.status === 'published') throw new PublisherFailure('conflict', 'invalid-transition')
        if (declaration.lifecycle.approval) {
          if (row.approval_id === null || row.review_version !== newest.version) throw new PublisherFailure('conflict', 'review-required')
          if (!await consented(row, newest, input.subject.identityId)) throw new PublisherFailure('conflict', 'approval-missing')
        }
        if (!consentRecorded(declaration, newest.content)) throw new PublisherFailure('conflict', 'consent-missing')
        if (scheduled) {
          await client.query(`update ${schemaName()}."document" set "status" = 'scheduled', "publish_at" = $2, "unpublish_at" = $3, "updated_at" = $4 where "id" = $1`, [row.id, publishAt, unpublishAt, at])
          await emit(client, 'publisher.document-scheduled', { siteId: row.site_id, documentId: row.id, type: row.type, version: newest.version, publishAt: publishAt.toISOString(), unpublishAt: unpublishAt?.toISOString() ?? null }, context)
        }
        else {
          await publishNow(client, row, newest, unpublishAt, context)
        }
        break
      }
      case 'unpublish':
      case 'archive': {
        if (request.acknowledgedLinks < await countBacklinks(client, siteId, row.id)) throw new PublisherFailure('conflict', 'still-linked')
        await takeDown(client, row, allowed[0] as 'draft' | 'archived', request.action === 'archive' ? 'archived' : 'unpublished', context)
        break
      }
      case 'reopen': {
        await client.query(`update ${schemaName()}."document" set "status" = 'draft', "updated_at" = $2 where "id" = $1`, [row.id, at])
        await emit(client, 'publisher.document-reopened', { siteId: row.site_id, documentId: row.id, type: row.type }, context)
        break
      }
      case 'moderate': {
        if (!declaration.lifecycle.moderation || row.moderation !== 'pending') throw new PublisherFailure('conflict', 'invalid-transition')
        if (request.outcome === 'accept') {
          if (!consentRecorded(declaration, newest.content)) throw new PublisherFailure('conflict', 'consent-missing')
          await client.query(`update ${schemaName()}."document" set "moderation" = 'accepted' where "id" = $1`, [row.id])
          await emit(client, 'publisher.submission-moderated', { siteId: row.site_id, documentId: row.id, type: row.type, outcome: 'accepted' }, context)
          await publishNow(client, { ...row, moderation: 'accepted' }, newest, null, context)
        }
        else {
          await client.query(
            `update ${schemaName()}."document" set "status" = 'archived', "moderation" = 'rejected', "updated_at" = $2 where "id" = $1`,
            [row.id, at],
          )
          await emit(client, 'publisher.submission-moderated', { siteId: row.site_id, documentId: row.id, type: row.type, outcome: 'rejected' }, context)
        }
        break
      }
    }
    return latest(client, siteId, row.id)
  })
}

/** Publishes what the clock has reached, archives what has run its course, and applies retention (§5.4, §9). */
export async function runMaintenance(): Promise<{ published: number, unpublished: number, versionsDeleted: number }> {
  const context = (): Context => ({ correlationId: uuidv7(now()), actorId: null })
  let published = 0
  let unpublished = 0
  let versionsDeleted = 0
  await inTransaction(async (client) => {
    const at = now()
    const { rows: due } = await client.query<DocumentRow>(`select * from ${schemaName()}."document" where "status" = 'scheduled' and "publish_at" <= $1 order by "publish_at", "id" for update`, [at])
    for (const row of due) {
      const declaration = declarationOf(row.type)
      const newest = (await loadVersion(client, row.id, row.latest_version))!
      // The schedule's consent is checked again: a version no longer consented to waits.
      if (declaration.lifecycle.approval && !await consented(row, newest, null)) continue
      if (!consentRecorded(declaration, newest.content)) continue
      await client.query('savepoint "due"')
      try {
        await publishNow(client, row, newest, row.unpublish_at, context())
        await client.query('release savepoint "due"')
        published++
      }
      catch (error) {
        await client.query('rollback to savepoint "due"')
        if (!(error instanceof PublisherFailure) || error.code !== 'conflict') throw error
      }
    }
    const { rows: ended } = await client.query<DocumentRow>(`select * from ${schemaName()}."document" where "status" = 'published' and "unpublish_at" <= $1 order by "unpublish_at", "id" for update`, [at])
    for (const row of ended) {
      await takeDown(client, row, 'archived', 'expired', context())
      unpublished++
    }
    for (const declaration of usePublisherRegistry().values()) {
      if (!declaration.personalData) continue
      const before = new Date(at.getTime() - declaration.personalData.retentionDays * 86_400_000)
      const { rowCount } = await client.query(
        `delete from ${schemaName()}."version" v using ${schemaName()}."document" d where v."document_id" = d."id" and d."type" = $1 and v."saved_at" < $2 and v."version" <> d."latest_version" and v."version" is distinct from d."published_version"`,
        [declaration.type, before],
      )
      versionsDeleted += rowCount ?? 0
    }
    if (versionsDeleted > 0) await emit(client, 'publisher.retention-applied', { versions: versionsDeleted }, context())
  })
  return { published, unpublished, versionsDeleted }
}

export type { VersionRow }
