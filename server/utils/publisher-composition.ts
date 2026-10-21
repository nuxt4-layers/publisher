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
import { buildPublisherRegistry, PublisherCompositionError } from '../../shared/contracts'

/**
 * Composition registry (docs/contracts.md §11). The host calls the
 * `provide*` functions from a Nitro plugin; the layer's server code calls
 * the `use*` functions. Required ports fail closed: using one before it is
 * supplied throws `PublisherCompositionError`. There is no implicit store
 * and no built-in document type.
 */

let database: (PublisherDatabase & { schema: string }) | null = null
let registry: PublisherRegistry = buildPublisherRegistry([])
let access: PublisherAccessDecision | null = null
let approval: PublisherApproval | null = null
let subjectResolver: PublisherSubjectResolver | null = null
let eventSink: PublisherEventSink | null = null
let assets: PublisherAssetResolver | null = null
let titleTemplate: PublisherTitleTemplate | null = null
let clock: PublisherClock | null = null

const NAME = /^[a-z_][a-z0-9_]{0,62}$/

const systemClock: PublisherClock = { now: () => new Date() }

function needs(value: unknown, functions: readonly string[], message: string): void {
  if (typeof value !== 'object' || value === null || functions.some(name => typeof (value as Record<string, unknown>)[name] !== 'function')) throw new TypeError(message)
}

/** The host's document types. A duplicate, an invalid declaration or a risk below the floor fails here, at start-up. */
export function providePublisherDocumentTypes(declarations: readonly PublisherTypeDeclarationInput[]): void {
  registry = buildPublisherRegistry(declarations)
}

export function providePublisherDatabase(next: PublisherDatabase): void {
  if (next?.dialect !== 'postgres' || typeof next.pool?.query !== 'function' || typeof next.pool.connect !== 'function') {
    throw new TypeError('providePublisherDatabase expects { dialect: \'postgres\', pool } with a pg-compatible pool.')
  }
  const schema = next.schema ?? 'publisher'
  if (!NAME.test(schema)) throw new TypeError(`Invalid publisher schema name '${schema}'.`)
  if (next.runtimeRole !== undefined && !NAME.test(next.runtimeRole)) throw new TypeError(`Invalid runtime role name '${next.runtimeRole}'.`)
  database = { ...next, schema }
}

/** Authorisation's decisions on the publisher's permissions. */
export function providePublisherAccessDecision(next: PublisherAccessDecision): void {
  needs(next, ['allows'], 'providePublisherAccessDecision expects an allows(input) function.')
  access = next
}

/** iam-integration's approvals, for types with `approval`. */
export function providePublisherApproval(next: PublisherApproval): void {
  needs(next, ['request', 'decision'], 'providePublisherApproval expects request(input) and decision(input) functions.')
  approval = next
}

/** The signed-in subject for an HTTP request; `null` when nobody is signed in. */
export function providePublisherSubjectResolver(next: PublisherSubjectResolver): void {
  needs(next, ['resolve'], 'providePublisherSubjectResolver expects a resolve(event) function.')
  subjectResolver = next
}

/** Where `relayPublisherOutbox` sends events. */
export function providePublisherEventSink(next: PublisherEventSink): void {
  needs(next, ['publish'], 'providePublisherEventSink expects a publish(events) function.')
  eventSink = next
}

/** Optional: the host's asset store. Without it, images are refused. */
export function providePublisherAssetResolver(next: PublisherAssetResolver): void {
  needs(next, ['resolve'], 'providePublisherAssetResolver expects a resolve(input) function.')
  assets = next
}

/** Optional: the host's title template. Without it, a document's title alone. */
export function providePublisherTitleTemplate(next: PublisherTitleTemplate): void {
  needs(next, ['format'], 'providePublisherTitleTemplate expects a format(input) function.')
  titleTemplate = next
}

/** Optional: the suite's clock. Without it, the system clock. */
export function providePublisherClock(next: PublisherClock): void {
  needs(next, ['now'], 'providePublisherClock expects a now() function.')
  clock = next
}

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new PublisherCompositionError(name)
  return value
}

/** The registered types. Empty until the host registers some. */
export const usePublisherRegistry = (): PublisherRegistry => registry
export const usePublisherDatabase = () => required(database, 'PublisherDatabase')
export const usePublisherAccessDecision = () => required(access, 'PublisherAccessDecision')
export const usePublisherApproval = () => required(approval, 'PublisherApproval')
export const usePublisherSubjectResolver = () => required(subjectResolver, 'PublisherSubjectResolver')
export const usePublisherEventSink = () => required(eventSink, 'PublisherEventSink')
/** Optional: `null` without it, and images are refused. */
export const usePublisherAssetResolver = (): PublisherAssetResolver | null => assets
/** Optional: `null` without it, and titles stand alone. */
export const usePublisherTitleTemplate = (): PublisherTitleTemplate | null => titleTemplate
export const usePublisherClock = (): PublisherClock => clock ?? systemClock

/** Test helper: removes every supplied port and registration. */
export function clearPublisherComposition(): void {
  database = null
  registry = buildPublisherRegistry([])
  access = null
  approval = null
  subjectResolver = null
  eventSink = null
  assets = null
  titleTemplate = null
  clock = null
}
