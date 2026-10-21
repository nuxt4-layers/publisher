/** The publisher's contract version (docs/contracts.md §17): frozen for 1.x once 1.0.0 ships. */
export const PUBLISHER_CONTRACT_VERSION = 1

/**
 * Public contract for `@nuxt4-layers/publisher`.
 *
 * The only supported cross-layer import path for the publisher's types and
 * pure helpers. It imports nothing but `zod`, and names no document type:
 * every type is the host's registration.
 */

export {
  correlationIdSchema,
  digestSchema,
  identifierSchema,
  instantSchema,
  reasonCodeSchema,
  REASON_CODE_PATTERN,
  UUID_PATTERN,
  UUID_V7_PATTERN,
} from './identifiers'

export type { PublisherConflictReason, PublisherContentProblem, PublisherErrorCode } from './errors'
export {
  PUBLISHER_CONFLICT_REASONS,
  PUBLISHER_CONTENT_PROBLEMS,
  PUBLISHER_ERROR_CODES,
  PUBLISHER_ERROR_STATUS,
  PublisherCompositionError,
  PublisherFailure,
} from './errors'

export {
  addressDateSchema,
  ASSET_ID_PATTERN,
  assetIdSchema,
  canonicalJson,
  codeSchema,
  httpsUrlSchema,
  localeSchema,
  safeTextSchema,
  SITE_ID_PATTERN,
  siteIdSchema,
  sitePathSchema,
  SLUG_PATTERN,
  slugSchema,
} from './values'

export type {
  PublisherAddressRule,
  PublisherEditorType,
  PublisherOrder,
  PublisherPermissionAction,
  PublisherRegistry,
  PublisherRisk,
  PublisherTypeDeclaration,
  PublisherTypeDeclarationInput,
} from './types'
export {
  addressRuleSchema,
  buildPublisherRegistry,
  definePublisherDocumentType,
  FIELD_NAME_PATTERN,
  PUBLISHER_MAX_RICH_TEXT_FIELDS,
  PUBLISHER_ORDERS,
  PUBLISHER_PERMISSION_ACTIONS,
  PUBLISHER_PERSONAL_DATA_RISK_FLOOR,
  PUBLISHER_RETENTION,
  PUBLISHER_RISK_FLOOR,
  PUBLISHER_RISKS,
  publisherPermission,
  publisherPermissions,
  publisherTypeDeclarationSchema,
  riskRank,
  TYPE_KEY_PATTERN,
  typeKeySchema,
} from './types'

export type {
  PublisherBacklink,
  PublisherConsent,
  PublisherContent,
  PublisherContentInput,
  PublisherDocument,
  PublisherDraft,
  PublisherModerationState,
  PublisherStatus,
  PublisherVersion,
} from './documents'
export {
  PUBLISHER_MODERATION_STATES,
  PUBLISHER_STATUSES,
  publisherBacklinkSchema,
  publisherConsentSchema,
  publisherContentSchema,
  publisherDocumentSchema,
  publisherDraftSchema,
  publisherVersionSchema,
} from './documents'

export type {
  PublisherAction,
  PublisherActionRequest,
  PublisherActionRequestInput,
  PublisherAssurance,
  PublisherSubject,
  PublisherTransition,
} from './lifecycle'
export {
  APPROVAL_FLOOR,
  CRITICAL_FRESHNESS_MINUTES,
  meetsStepUp,
  PUBLISHER_ACTIONS,
  PUBLISHER_SCHEDULED_TRANSITIONS,
  PUBLISHER_TRANSITIONS,
  publisherActionRequestSchema,
  subjectSchema,
} from './lifecycle'

export type {
  PublisherFeedFormat,
  PublisherHead,
  PublisherListing,
  PublisherListingQuery,
  PublisherRendered,
  PublisherResolution,
  PublisherResolvedLinks,
  PublisherSitemapEntry,
} from './reading'
export {
  PUBLISHER_FEED_FORMATS,
  publisherHeadSchema,
  publisherListingQuerySchema,
  publisherListingSchema,
  publisherRenderedSchema,
  publisherResolutionSchema,
  publisherResolvedLinksSchema,
  publisherSitemapEntrySchema,
} from './reading'

export type { PublisherBundle, PublisherBundleDocument, PublisherPersonExport } from './bundle'
export { PUBLISHER_BUNDLE_FORMAT, publisherBundleDocumentSchema, publisherBundleSchema, publisherPersonExportSchema } from './bundle'

export type { PublisherEvent, PublisherEventType } from './events'
export { publisherEventSchema } from './events'

export type {
  Consistency,
  PostgresPoolLike,
  PublisherAccessDecision,
  PublisherApproval,
  PublisherApprovalState,
  PublisherAssetResolver,
  PublisherClock,
  PublisherDatabase,
  PublisherEventSink,
  PublisherSiteResolver,
  PublisherSubjectResolver,
  PublisherTitleTemplate,
} from './ports'
