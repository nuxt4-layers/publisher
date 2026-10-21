import { z } from 'zod'
import type { PublisherStatus } from './documents'
import { publisherContentSchema } from './documents'
import { instantSchema } from './identifiers'
import type { PublisherPermissionAction, PublisherRisk } from './types'

/**
 * The lifecycle (docs/contracts.md §5): one state machine for every type.
 * The table is the contract; the server applies it and nothing else.
 */

export const PUBLISHER_ACTIONS = ['save', 'submit', 'withdraw', 'publish', 'unpublish', 'archive', 'reopen', 'restore', 'moderate'] as const
export type PublisherAction = typeof PUBLISHER_ACTIONS[number]

export interface PublisherTransition {
  /** The permission the action needs on the document's type. */
  readonly permission: PublisherPermissionAction
  /** From each status the action may start in, the statuses it may end in. */
  readonly from: Readonly<Partial<Record<PublisherStatus, readonly PublisherStatus[]>>>
}

export const PUBLISHER_TRANSITIONS: Readonly<Record<PublisherAction, PublisherTransition>> = {
  // A new version. Saving takes a document out of review or its schedule;
  // a published document stays published at its published version.
  'save': { permission: 'edit', from: { 'draft': ['draft'], 'in-review': ['draft'], 'scheduled': ['draft'], 'published': ['published'] } },
  // Types with `review`: asks the approval port about the newest version.
  'submit': { permission: 'edit', from: { 'draft': ['in-review'], 'published': ['published'] } },
  'withdraw': { permission: 'edit', from: { 'in-review': ['draft'], 'scheduled': ['draft'] } },
  // `scheduled` when `publishAt` is in the future.
  'publish': { permission: 'publish', from: { 'draft': ['published', 'scheduled'], 'in-review': ['published', 'scheduled'], 'published': ['published'] } },
  'unpublish': { permission: 'publish', from: { published: ['draft'] } },
  'archive': { permission: 'publish', from: { 'draft': ['archived'], 'in-review': ['archived'], 'scheduled': ['archived'], 'published': ['archived'] } },
  'reopen': { permission: 'edit', from: { archived: ['draft'] } },
  // A new version with an earlier version's content; otherwise as `save`.
  'restore': { permission: 'edit', from: { 'draft': ['draft'], 'in-review': ['draft'], 'scheduled': ['draft'], 'published': ['published'] } },
  // Types with `moderation`, on a pending submission: accept publishes, reject archives.
  'moderate': { permission: 'moderate', from: { 'in-review': ['published', 'archived'] } },
}

/** What `runPublisherMaintenance` does when the clock passes a document's times (§5.4). No permission: the schedule was approved when set. */
export const PUBLISHER_SCHEDULED_TRANSITIONS = [
  { at: 'publishAt', from: 'scheduled', to: 'published' },
  { at: 'unpublishAt', from: 'published', to: 'archived' },
] as const satisfies readonly { at: 'publishAt' | 'unpublishAt', from: PublisherStatus, to: PublisherStatus }[]

const expectedVersion = z.number().int().min(1)

/** An action on a document, as the administration endpoint and `transitionPublisherDocument` take it. */
export const publisherActionRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('save'), expectedVersion, content: publisherContentSchema }),
  z.strictObject({ action: z.literal('submit'), expectedVersion }),
  z.strictObject({ action: z.literal('withdraw'), expectedVersion }),
  z.strictObject({ action: z.literal('publish'), expectedVersion, publishAt: instantSchema.nullable().default(null), unpublishAt: instantSchema.nullable().default(null) }),
  // The number of linking documents the editor was shown (§7.3).
  z.strictObject({ action: z.literal('unpublish'), expectedVersion, acknowledgedLinks: z.number().int().min(0) }),
  z.strictObject({ action: z.literal('archive'), expectedVersion, acknowledgedLinks: z.number().int().min(0) }),
  z.strictObject({ action: z.literal('reopen'), expectedVersion }),
  z.strictObject({ action: z.literal('restore'), expectedVersion, version: z.number().int().min(1) }),
  z.strictObject({ action: z.literal('moderate'), expectedVersion, outcome: z.enum(['accept', 'reject']) }),
])
export type PublisherActionRequest = z.output<typeof publisherActionRequestSchema>
export type PublisherActionRequestInput = z.input<typeof publisherActionRequestSchema>

/** Approvers needed beyond the requester, by the publish permission's risk (iam-integration's approvals process). */
export const APPROVAL_FLOOR: Readonly<Record<PublisherRisk, number>> = { low: 0, medium: 0, high: 1, critical: 1 }

/** A `critical` action needs a phishing-resistant sign-in this recent. */
export const CRITICAL_FRESHNESS_MINUTES = 15

/** A subject's assurance, from Authentication through the host. */
export interface PublisherAssurance {
  level: 'aal1' | 'aal2' | 'aal3'
  phishingResistant: boolean
  /** When the subject last authenticated (ISO 8601). */
  authenticatedAt: string
}

/** Who acts, from the host's subject resolver only. */
export interface PublisherSubject {
  identityId: string
  kind: 'person' | 'service'
  assurance: PublisherAssurance
}

export const subjectSchema = z.strictObject({
  identityId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  kind: z.enum(['person', 'service']),
  assurance: z.strictObject({
    level: z.enum(['aal1', 'aal2', 'aal3']),
    phishingResistant: z.boolean(),
    authenticatedAt: instantSchema,
  }),
})

/**
 * Whether the assurance is enough for an action at this risk: `high` needs
 * aal2; `critical` aal2, phishing resistant, within 15 minutes. As
 * Configuration's and the IAM members'.
 */
export function meetsStepUp(risk: PublisherRisk, assurance: PublisherAssurance, now: Date): boolean {
  if (risk === 'low' || risk === 'medium') return true
  if (assurance.level === 'aal1') return false
  if (risk === 'high') return true
  const age = now.getTime() - Date.parse(assurance.authenticatedAt)
  return assurance.phishingResistant && age >= 0 && age <= CRITICAL_FRESHNESS_MINUTES * 60_000
}
