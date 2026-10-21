import type {
  PublisherActionRequestInput,
  PublisherBacklink,
  PublisherBundle,
  PublisherContentInput,
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
import { PublisherCompositionError } from '../../shared/contracts'
import { runPublisherMigrations } from '../database/migrations'
import * as reading from '../internal/reading'
import { guarded, withClient } from '../internal/store'
import * as writing from '../internal/writing'
import {
  usePublisherAccessDecision,
  usePublisherApproval,
  usePublisherDatabase,
  usePublisherEventSink,
  usePublisherRegistry,
} from './publisher-composition'

/**
 * The publisher's server functions (docs/contracts.md §13), auto-imported
 * in the host's server code. Every one parses what it answers with the
 * contract's schemas. The subject is always the signed-in principal, passed
 * by the caller from the host's resolver, never from a request body.
 */

interface Acting {
  /** The site, from the host's site resolver or its own server code (§3.4). */
  siteId: string
  subject: PublisherSubject
  correlationId: string
}

interface Viewing {
  siteId: string
  /** The signed-in viewer, or `null` for an anonymous reader. */
  viewer?: PublisherSubject | null
  /** Ask for the newest version; needs the type's `view-draft`, else answers as missing. */
  preview?: boolean
}

/** Applies append-only migrations through the migration pool. */
export async function migratePublisherDatabase(): Promise<string[]> {
  const database = usePublisherDatabase()
  return guarded(() => runPublisherMigrations(database.migrationPool ?? database.pool, database.schema, database.runtimeRole))
}

/**
 * Checks the composition at start-up: every required port supplied, and no
 * stored document of a type the host has not registered. Throws
 * `PublisherCompositionError`; a host calls it after migrating.
 */
export async function checkPublisherComposition(): Promise<void> {
  usePublisherDatabase()
  usePublisherAccessDecision()
  usePublisherEventSink()
  if ([...usePublisherRegistry().values()].some(declaration => declaration.lifecycle.approval)) usePublisherApproval()
  await withClient(async () => {})
  if (usePublisherRegistry().size === 0) throw new PublisherCompositionError('PublisherDocumentTypes', 'No document type is registered.')
}

/** A new draft, version 1 (§5). Needs `edit`. */
export async function createPublisherDocument(input: Acting & { type: string, content: PublisherContentInput }): Promise<PublisherDocument> {
  return writing.createDocument(input)
}

/** Any action of the state machine (§5.1): save, submit, withdraw, publish, unpublish, archive, reopen, restore, moderate. */
export async function transitionPublisherDocument(input: Acting & { documentId: string, request: PublisherActionRequestInput }): Promise<PublisherDocument> {
  return writing.transitionDocument(input)
}

/**
 * A submission to a type with `moderation`, from the host's own form
 * handling (§5.3): it waits, hidden, for a moderator. `submitterId` is the
 * signed-in person, or `null`.
 */
export async function receivePublisherSubmission(input: { siteId: string, correlationId: string, submitterId: string | null, type: string, content: PublisherContentInput }): Promise<{ documentId: string }> {
  return writing.receiveSubmission(input)
}

/** A document's newest version, for administration. Needs `view-draft`; otherwise `forbidden`. */
export async function getPublisherDocument(input: { siteId: string, subject: PublisherSubject, documentId: string, version?: number }): Promise<PublisherDocument> {
  return reading.getDocument(input)
}

/** Documents of a type, for administration, newest change first. Needs `view-draft`. */
export async function listPublisherDocuments(input: { siteId: string, subject: PublisherSubject, type: string, search?: string, status?: PublisherStatus, limit?: number, offset?: number }): Promise<PublisherListing> {
  return reading.listDocuments(input)
}

/** Submissions awaiting a moderator, of every type the subject may moderate. */
export async function listPublisherModerationQueue(input: { siteId: string, subject: PublisherSubject, type?: string }): Promise<PublisherListing> {
  return reading.listModerationQueue(input)
}

/** Every saved version, newest first. Needs `view-draft`. */
export async function listPublisherHistory(input: { siteId: string, subject: PublisherSubject, documentId: string }): Promise<PublisherVersion[]> {
  return reading.listHistory(input)
}

/** Every document whose newest or published version links to this one (§7.3). Needs `view-draft` on its type. */
export async function listPublisherBacklinks(input: { siteId: string, subject: PublisherSubject, documentId: string }): Promise<PublisherBacklink[]> {
  return reading.listBacklinks(input)
}

/** What a request path is now: a document, a redirect or nothing (§7.1). */
export async function resolvePublisherPath(input: Viewing & { path: string }): Promise<PublisherResolution> {
  return reading.resolvePath(input)
}

/** A published document by path or id, ready to render; `null` for anything the viewer may not see. */
export async function getPublishedDocument(input: Viewing & ({ path: string } | { documentId: string })): Promise<PublisherRendered | null> {
  return reading.getPublished(input)
}

/** Published documents of a listable type (§8.1). */
export async function listPublishedDocuments(query: PublisherListingQuery): Promise<PublisherListing> {
  return reading.listPublished(query)
}

/** An RSS 2.0 or Atom 1.0 feed of a listable type's newest published documents (§8.2). */
export async function getPublisherFeed(input: { siteId: string, type: string, format: PublisherFeedFormat, origin: string, limit?: number }): Promise<string> {
  return reading.getFeed(input)
}

/** Every published, addressed document, for the host's `sitemap.xml` (§8.3). */
export async function listPublisherSitemapEntries(input: { siteId: string }): Promise<PublisherSitemapEntry[]> {
  return reading.listSitemap(input)
}

/** Publishes and unpublishes what the clock has reached, and applies retention (§5.4, §9). Never an endpoint. */
export async function runPublisherMaintenance(): Promise<{ published: number, unpublished: number, versionsDeleted: number }> {
  return writing.runMaintenance()
}

/** Relays outbox events to the event sink, at least once, in order. Answers how many were sent. */
export async function relayPublisherOutbox(input: { limit?: number } = {}): Promise<number> {
  return reading.relayOutbox(input)
}

/** The portable bundle (§16), of some types or all. Server-only. */
export async function exportPublisherContent(input: { siteId: string, types?: readonly string[] }): Promise<PublisherBundle> {
  return reading.exportContent(input)
}

/** Imports a bundle into documents that do not exist yet; how a host seeds content. Server-only. */
export async function importPublisherContent(input: { siteId: string, bundle: unknown, correlationId: string }): Promise<{ documents: number, versions: number }> {
  return reading.importContent(input)
}

/** A person's documents of personal-data types on every site, with every version (§9). Server-only. */
export async function exportPublisherPersonData(input: { identityId: string }): Promise<PublisherPersonExport> {
  return reading.exportPerson(input)
}

/** Erases a person's documents of personal-data types, their history, links and redirects (§9). Server-only. */
export async function erasePublisherPerson(input: { identityId: string, correlationId: string }): Promise<{ documents: number, versions: number }> {
  return reading.erasePerson(input)
}
