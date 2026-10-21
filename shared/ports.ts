import type { PublisherEvent } from './events'
import type { PublisherSubject } from './lifecycle'
import type { PublisherRisk } from './types'

/**
 * Ports the host supplies (docs/contracts.md §11), in the publisher's own
 * vocabulary. Every port rejects on failure; the publisher then fails
 * closed as `unavailable`, never on a null, partial or stale answer.
 */

export interface PostgresPoolLike {
  query(text: string, values?: readonly unknown[]): Promise<unknown>
  connect(): Promise<unknown>
}

/** Persistence (ADR-0002, ADR-0006). `pool` connects as the runtime role. */
export interface PublisherDatabase {
  dialect: 'postgres'
  pool: PostgresPoolLike
  /** Schema owned by this capability. Defaults to `publisher`. */
  schema?: string
  migrationPool?: PostgresPoolLike
  /** The runtime role to grant, when migrations run as another role. */
  runtimeRole?: string
}

export type Consistency = 'strong' | 'bounded'

/**
 * Authorisation, through the host: whether an identity holds one of the
 * publisher's permissions now. `documentId` is `null` for type-wide
 * questions (listing, creating); the host decides on which group to ask.
 */
export interface PublisherAccessDecision {
  allows(input: { identityId: string, permission: string, type: string, documentId: string | null, consistency: Consistency }): Promise<boolean>
}

export type PublisherApprovalState = 'pending' | 'approved' | 'rejected' | 'expired'

/**
 * iam-integration's approvals process, through the host. The publisher asks
 * once per version and binds the answer to that version's digest.
 */
export interface PublisherApproval {
  request(input: {
    documentId: string
    type: string
    version: number
    digest: string
    permission: string
    risk: PublisherRisk
    /** Approvers needed beyond the requester (`APPROVAL_FLOOR`). */
    requiredApprovals: number
    requesterId: string
    correlationId: string
  }): Promise<{ approvalId: string }>
  decision(input: { approvalId: string }): Promise<{ state: PublisherApprovalState, digest: string, approverIds: readonly string[] }>
}

/** Who is signed in, for an HTTP request (an h3 event, typed loosely). `null` when nobody is. */
export interface PublisherSubjectResolver {
  resolve(event: unknown): Promise<PublisherSubject | null>
}

export interface PublisherClock {
  now(): Date
}

/** Where relayed events go, at least once and in order. */
export interface PublisherEventSink {
  publish(events: readonly PublisherEvent[]): Promise<void>
}

/** The host's asset store: each asset's address, or `null` when unknown. */
export interface PublisherAssetResolver {
  resolve(input: { assetIds: readonly string[] }): Promise<Readonly<Record<string, { url: string, width?: number, height?: number } | null>>>
}

/** The host's title template, e.g. Configuration's `seo.title-template`. */
export interface PublisherTitleTemplate {
  format(input: { title: string, type: string, locale: string }): string | Promise<string>
}
