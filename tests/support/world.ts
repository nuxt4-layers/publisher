import type {
  PublisherAccessDecision,
  PublisherApproval,
  PublisherApprovalState,
  PublisherAssetResolver,
  PublisherClock,
  PublisherEvent,
  PublisherEventSink,
  PublisherSubject,
  PublisherTitleTemplate,
} from '../../shared/contracts'

/**
 * Stand-ins for the host's ports, held in memory, so the tests decide who
 * holds which permission, what the approvals process answers, what time it
 * is and which assets exist.
 */

let counter = 0x100

/** A fresh UUIDv7 for tests. */
export function id(): string {
  counter++
  return `01928c4e-0000-7000-8000-${counter.toString(16).padStart(12, '0')}`
}

interface ApprovalRecord {
  input: Parameters<PublisherApproval['request']>[0]
  state: PublisherApprovalState
  approverIds: string[]
}

export class World {
  /** `identityId|permission` */
  readonly grants = new Set<string>()
  readonly approvals = new Map<string, ApprovalRecord>()
  readonly published: PublisherEvent[] = []
  readonly assets = new Map<string, string>()
  failing = false
  sinkFailing = false
  time = new Date('2026-10-21T09:00:00.000Z')

  private check(): void {
    if (this.failing) throw new Error('port down')
  }

  grant(identityId: string, ...permissions: string[]): void {
    for (const permission of permissions) this.grants.add(`${identityId}|${permission}`)
  }

  /** Every permission on a type: `view-draft`, `edit`, `publish`, `moderate`. */
  grantAll(identityId: string, type: string): void {
    this.grant(identityId, ...['view-draft', 'edit', 'publish', 'moderate'].map(action => `publisher.${type}.${action}`))
  }

  revoke(identityId: string, permission: string): void {
    this.grants.delete(`${identityId}|${permission}`)
  }

  advance(minutes: number): void {
    this.time = new Date(this.time.getTime() + minutes * 60_000)
  }

  /** The approvals process approves, as these people. */
  approve(approvalId: string, ...approverIds: string[]): void {
    const record = this.approvals.get(approvalId)!
    record.state = 'approved'
    record.approverIds.push(...approverIds)
  }

  reject(approvalId: string): void {
    this.approvals.get(approvalId)!.state = 'rejected'
  }

  /** The newest approval asked for this document. */
  approvalFor(documentId: string): string | undefined {
    return [...this.approvals.entries()].reverse().find(([, record]) => record.input.documentId === documentId)?.[0]
  }

  readonly access: PublisherAccessDecision = {
    allows: async ({ identityId, permission }) => {
      this.check()
      return this.grants.has(`${identityId}|${permission}`)
    },
  }

  readonly approval: PublisherApproval = {
    request: async (input) => {
      this.check()
      const approvalId = id()
      this.approvals.set(approvalId, { input, state: 'pending', approverIds: [] })
      return { approvalId }
    },
    decision: async ({ approvalId }) => {
      this.check()
      const record = this.approvals.get(approvalId)
      if (!record) throw new Error('unknown approval')
      return { state: record.state, digest: record.input.digest, approverIds: record.approverIds }
    },
  }

  readonly clock: PublisherClock = { now: () => new Date(this.time) }

  readonly sink: PublisherEventSink = {
    publish: async (events) => {
      if (this.sinkFailing) throw new Error('sink down')
      this.published.push(...events)
    },
  }

  readonly assetResolver: PublisherAssetResolver = {
    resolve: async ({ assetIds }) => {
      this.check()
      return Object.fromEntries(assetIds.map(assetId => [assetId, this.assets.has(assetId) ? { url: this.assets.get(assetId)! } : null]))
    },
  }

  readonly titleTemplate: PublisherTitleTemplate = { format: ({ title }) => `${title} · Test site` }
}

/** A signed-in person; `strong` is aal2, phishing resistant, just now. */
export function person(identityId: string, at: Date, strength: 'weak' | 'strong' = 'strong'): PublisherSubject {
  return {
    identityId,
    kind: 'person',
    assurance: strength === 'strong'
      ? { level: 'aal2', phishingResistant: true, authenticatedAt: at.toISOString() }
      : { level: 'aal1', phishingResistant: false, authenticatedAt: at.toISOString() },
  }
}
