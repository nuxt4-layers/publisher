import type {
  PublisherAccessDecision,
  PublisherApproval,
  PublisherAssetResolver,
  PublisherClock,
  PublisherDatabase,
  PublisherEventSink,
  PublisherRegistry,
  PublisherSubjectResolver,
  PublisherTitleTemplate,
  PublisherTypeDeclarationInput,
} from '../../shared/contracts'
import { pending } from '../../shared/pending'

/**
 * Composition registry (docs/contracts.md §11). The host calls the
 * `provide*` functions from a Nitro plugin; the layer's server code calls
 * the `use*` functions. Required ports fail closed: using one before it is
 * supplied throws `PublisherCompositionError`. There is no implicit store
 * and no built-in document type.
 */

/** The host's document types. A duplicate, an invalid declaration or a risk below the floor fails here, at start-up. */
export function providePublisherDocumentTypes(declarations: readonly PublisherTypeDeclarationInput[]): void {
  pending(`providePublisherDocumentTypes(${declarations.length})`)
}

export function providePublisherDatabase(next: PublisherDatabase): void {
  pending(`providePublisherDatabase(${next?.dialect})`)
}

/** Authorisation's decisions on the publisher's permissions. */
export function providePublisherAccessDecision(next: PublisherAccessDecision): void {
  pending(`providePublisherAccessDecision(${typeof next})`)
}

/** iam-integration's approvals, for types with `review`. */
export function providePublisherApproval(next: PublisherApproval): void {
  pending(`providePublisherApproval(${typeof next})`)
}

/** The signed-in subject for an HTTP request; `null` when nobody is signed in. */
export function providePublisherSubjectResolver(next: PublisherSubjectResolver): void {
  pending(`providePublisherSubjectResolver(${typeof next})`)
}

/** Where `relayPublisherOutbox` sends events. */
export function providePublisherEventSink(next: PublisherEventSink): void {
  pending(`providePublisherEventSink(${typeof next})`)
}

/** Optional: the host's asset store. Without it, images are refused. */
export function providePublisherAssetResolver(next: PublisherAssetResolver): void {
  pending(`providePublisherAssetResolver(${typeof next})`)
}

/** Optional: the host's title template. Without it, a document's title alone. */
export function providePublisherTitleTemplate(next: PublisherTitleTemplate): void {
  pending(`providePublisherTitleTemplate(${typeof next})`)
}

/** Optional: the suite's clock. Without it, the system clock. */
export function providePublisherClock(next: PublisherClock): void {
  pending(`providePublisherClock(${typeof next})`)
}

/** The registered types. Empty until the host registers some. */
export function usePublisherRegistry(): PublisherRegistry {
  return pending('usePublisherRegistry')
}

/** Test helper: removes every supplied port and registration. */
export function clearPublisherComposition(): void {
  pending('clearPublisherComposition')
}
