# Publisher Contract (version 1)

`@nuxt4-layers/publisher/contracts` is the only supported import path for this capability's types and pure helpers. It imports nothing but `zod`: no Nuxt, Vue, h3, server code, driver or other `@nuxt4-layers/*` package.

The publisher answers one question: **which version of which document is published at which address, for whom, now?** It owns the lifecycle every published document shares, and knows nothing about what any document is: every document type is the host's registration (§3). This is contract version 1 (§17); section numbers are stable.

## 1. Boundaries

| Concern | Owner | How the publisher sees it |
|---|---|---|
| Drafts, versions, history, review, moderation, scheduling, addresses, redirects, links between documents, safe rich text, listings, feeds | **Publisher** | §4 to §8 |
| What a document is: its fields, address rule, listing, lifecycle options | The host | A registered type declaration (§3) |
| Site name, legal entity, contacts, SEO defaults | The host, from `nuxt4-layers/configuration` | The title-template port (§11); nothing else |
| The site shell, routes and every screen | The host, a kit or `ui` | Never. The layer is headless (§15) |
| Contact forms and sending mail | The host, or a later forms service | Never. A form may hand a submission to `receivePublisherSubmission` (§5.3) |
| `security.txt` | The host, from Configuration's `contact.security` | Never |
| Images and files | The host's asset store | `asset:` references, resolved through the asset port (§6.2) |
| People's names | Profile | Opaque identity identifiers only (§4); the host's screens ask Profile (§15) |
| Who may do what | The IAM suite | The access-decision and approval ports (§11), on the permissions of §10 |
| Editing content: forms, rich-text editing, authoring | `nuxt4-layers/content-editor`, or the host's own form controls | Never. The server checks every save (§6.5) |

## 2. What the publisher holds

Documents of registered types, every saved version of each, the addresses they had (as redirects), the links between them, the approvals asked of the approval port, and a transactional outbox. Nothing else: no type of its own, no site settings, no files, no names, no permissions.

A type may declare that its documents hold a person's words or identity (§9). Such content is exported and erased by the person's identifier, and its history kept no longer than the type's retention period.

## 3. Document types

### 3.1 Declarations

Registered once at start-up with `providePublisherDocumentTypes(declarations)`. Each declaration is a strict object, checked against the meta-schema (`publisherTypeDeclarationSchema`) and then by `buildPublisherRegistry`:

| Field | Meaning |
|---|---|
| `type` | The key: lower-case ASCII with `-`, 1 to 40 characters, starting with a letter (a segment of Configuration's keys), e.g. what a host calls its pages or its posts |
| `label` | `{ one, many }`: safe text, up to 60 each, for administration and feed titles |
| `fields` | A zod schema for the type's own content: a strict object (`z.strictObject`); every string, array and record within it bounded. Formatted fields are `richTextSchema({ profile, max })` (§6); their `doc:` links are extracted (§7.3) |
| `address` | `{ kind: 'none' }` for documents only ever embedded or listed; or `{ kind: 'path', base, pattern }`, `base` being `''` (the site's root) or a site path without a trailing `/`, and `pattern` `slug` (`{base}/{slug}`) or `date-slug` (`{base}/{YYYY}/{MM}/{DD}/{slug}`) |
| `listing` | `{ listable, order, filterable }`: whether the type is listed and fed (§8); its default order (`published-desc`, `published-asc`, `title-asc`, `updated-desc`); top-level fields readers may filter on, each a bounded string, an enumeration or an array of either. Default: not listable |
| `lifecycle` | `{ approval, moderation, scheduling, risks }`: whether publishing needs the approval port's consent (§5.2); whether submissions are moderated (§5.3; not with `approval`); whether `publishAt` and `unpublishAt` may be set (§5.4); and each permission's risk (§10), never below the floor. Default: all `false`, risks at the floor |
| `personalData` | `null`, or `{ subjectField, consentField, retentionDays }` (§9): the field holding the person's identity identifier (a UUIDv7); the field holding their consent (`publisherConsentSchema`, optional in the schema so a draft may lack it); and how long superseded versions are kept, 30 to 2,190 days |

A declaration is refused at start-up, failing closed, when it is invalid against the meta-schema; when its `fields` is not a strict object or holds an unbounded string, array or record; when it has more than 20 formatted fields; when a filterable, subject or consent field does not exist or has the wrong shape; when it declares both `approval` and `moderation`; or when a risk is below the floor. Two declarations of one `type` are refused likewise. `definePublisherDocumentType` types a declaration without registering it.

### 3.2 Addresses

A document of an addressed type carries a `slug` (up to 8 segments of `[a-z0-9]` words joined by `-`, separated by `/`; at most 200 characters; the empty slug is the base itself) and, for `date-slug`, an `addressDate` (`YYYY-MM-DD`; the first publishing date when omitted). Its `path` is derived from them; a document of a type without an address has neither (`address-not-allowed`), and an addressed one must have a slug (`address-required`). A path is unique among published documents across every type (`address-taken` on publishing; drafts may share). A trailing `/` is the same address and redirects to the one without.

### 3.3 Registration rules

- The layer registers no type, and its own source names none (`tests/contracts.test.ts` searches it). Reference declarations are exported from `@nuxt4-layers/publisher/examples` as examples only.
- Adding a type is a registration, never a change to the layer: the same code stores, versions, reviews, publishes, lists, feeds and exports every type (`tests/lifecycle.test.ts` proves it with types defined only in the tests).
- A document of a type the host does not register is refused (`validation-failed`, `unknown-type`). If the database holds documents of a type the host no longer registers, `checkPublisherComposition()` fails at start-up and every server function fails closed (`unavailable`) rather than serve them as something else.
- Raising a type's risk, adding a field, or making a field optional applies to new versions; stored versions keep the content they were saved with and are checked again only when they are published or restored.

### 3.4 Sites

Every document belongs to one **site**: the host's opaque identifier of where documents are published (`siteIdSchema`: lower-case ASCII letters, digits and `-`, up to 64 characters), such as Identity's tenant identifier for the tenant Configuration finds by host name, or one fixed name for a host with one site. Types are registered once for every site.

- Every server function but migration, the start-up check, maintenance, the relay and a person's export and erasure names its site; the endpoints take it only from the host's site resolver (§11). A request for no site finds nothing (`not-found`) and administers nothing (`forbidden`).
- A document is addressed, listed, fed, mapped, linked, redirected, moderated and administered on its own site only. On any other site it is as missing as one that never existed, whatever the viewer's permissions there.
- Addresses are unique per site: two sites may publish at the same path. `doc:` links resolve only to documents of the same site; anything else renders as text.
- The access-decision, approval, asset and title-template ports are told the site, so a host maps each site to its own group, approvals, asset store and title.
- A person's export and erasure cover every site, and say which site each document was on.

## 4. The envelope

The same for every type (`publisherDocumentSchema`):

| Group | Fields |
|---|---|
| Identity and content | `id` (UUIDv7), `siteId` (§3.4), `type`, `locale` (BCP 47), `title` (safe text, 1 to 200), `summary` (safe text up to 500, or `null`), `fields` (the type's own, parsed by its schema), `slug`, `addressDate`, `path` |
| Lifecycle | `status` (`draft`, `in-review`, `scheduled`, `published`, `archived`), `publishAt`, `unpublishAt`, `version` (of these contents), `latestVersion`, `publishedVersion`, `reviewVersion`, `moderation` (`pending`, `accepted`, `rejected` or `null`), `createdAt`, `updatedAt`, `publishedAt` |
| People | `authors`: up to 20 opaque identity identifiers. Names are the host's |

What an editor writes is the content of one version (`publisherContentSchema`): `locale`, `title`, `summary`, `fields`, `slug`, `addressDate` and `authors`. Every save is a new version.

## 5. The lifecycle

### 5.1 The state machine

One state machine for every type (`PUBLISHER_TRANSITIONS`). Each action names the permission it needs on the document's type (§10) and carries `expectedVersion`, the newest version the editor saw; any other is refused (`conflict`, `version-stale`).

| Action | Permission | From → to | Notes |
|---|---|---|---|
| create | `edit` | → `draft` | Version 1 |
| `save` | `edit` | `draft`, `in-review`, `scheduled` → `draft`; `published` → `published` | A new version. Saving takes a document out of review or its schedule. A published document stays published at its `publishedVersion` |
| `submit` | `edit` | `draft` → `in-review`; `published` → `published` | Types with `approval` only: asks the approval port about the newest version (§5.2), recording `reviewVersion` |
| `withdraw` | `edit` | `in-review`, `scheduled` → `draft` | Clears `publishAt` and the request |
| `publish` | `publish` | `draft`, `in-review` → `published` or `scheduled`; `published` → `published` | Publishes the newest version, or schedules it when `publishAt` is in the future. Needs consent (§5.2), recorded consent for personal data (§9), and the step-up of the permission's risk |
| `unpublish` | `publish` | `published` → `draft` | With `acknowledgedLinks` (§7.3) |
| `archive` | `publish` | any but `archived` → `archived` | With `acknowledgedLinks` (§7.3) |
| `reopen` | `edit` | `archived` → `draft` | The only way out of `archived` |
| `restore` | `edit` | as `save` | A new version with an earlier version's content (`restoredFrom`) |
| `moderate` | `moderate` | `in-review` with `moderation: pending` → `published` (accept) or `archived` (reject) | Types with `moderation` only (§5.3) |

An action not allowed from the current status is `conflict`, `invalid-transition`. Only the published version is public (§8.4). Every action is checked through the access-decision port at `strong` consistency, and a subject short of the step-up for the permission's risk (`meetsStepUp`: `high` aal2; `critical` aal2, phishing resistant, within 15 minutes) is refused `insufficient-assurance`.

### 5.2 Approval

A type with `lifecycle.approval` never publishes without the approval port's consent, which the host maps to iam-integration's [approvals process](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/approvals.md):

- `submit` asks `approval.request` about the newest version, with its **digest** (SHA-256 of the canonical JSON of the document's id, type, version and content), the publish permission, its risk, the requester and the approvers needed beyond the requester (`APPROVAL_FLOOR`: none for `low` and `medium`, one for `high` and `critical`), as in Configuration.
- `publish` asks `approval.decision` and publishes only when the answer is `approved`, bound to the same digest as the version being published, with enough approvers other than the requester and the publisher. Otherwise `conflict`, `approval-missing`; publishing before submitting is `review-required`.
- Saving after submitting asks again: the consent was to the old version's digest.
- Without the approval port, every type with `approval` fails closed (`unavailable`), and so does `checkPublisherComposition()`.

### 5.3 Moderation

A type with `lifecycle.moderation` takes submissions from the host's own form handling through `receivePublisherSubmission({ type, submitterId, content, correlationId })`, server-only: the host decides who may submit. A submission is a document in `in-review` with `moderation: pending`, hidden from readers, listings and feeds, and listed in the moderation queue to those holding the type's `moderate`. `publish` cannot release it (`not-moderated`); only `moderate` does, accepting (published) or rejecting (archived, `moderation: rejected`). Editors may still create documents of the type directly, which follow §5.1.

### 5.4 Scheduling

For types with `lifecycle.scheduling`, `publish` may carry `publishAt` (in the future: `scheduled`) and `unpublishAt` (after `publishAt` and now). Otherwise either is `conflict`, `scheduling-disabled`. `runPublisherMaintenance()`, run by the host on a schedule (never an endpoint), publishes `scheduled` documents whose `publishAt` the clock has reached and archives `published` documents whose `unpublishAt` it has reached (`PUBLISHER_SCHEDULED_TRANSITIONS`), and not before. The schedule's consent and permission were checked when it was set; maintenance checks the approval's digest again and leaves a document scheduled if it no longer holds.

### 5.5 Versions and history

Every save, restore and import is a new version, kept with who saved it, when, and the version it restored. `listPublisherHistory` lists them newest first; `getPublisherDocument({ version })` reads one; `restore` makes an earlier one the newest. Versions are kept for as long as the document, except superseded versions of personal-data types (§9) and erased documents.

## 6. Rich text

Formatted fields use the platform's one format, [`@nuxt4-layers/rich-text`](https://github.com/nuxt4-layers/rich-text/blob/e0b07a2f0754ac0b96f3c11a42346f63690c8887/README.md) (ADR-0011), pinned at `v2.0.0`. Every other string is plain and never read as rich text.

### 6.1 Profiles

A field is formatted when its schema is `richTextSchema({ profile, max })`; the registry finds such fields from `fields` (`richTextFields`). A type has at most 20 (`PUBLISHER_MAX_RICH_TEXT_FIELDS`).

| Profile | Allows |
|---|---|
| `inline` | One paragraph: bold, italic, links, line breaks |
| `block` | Inline, plus headings, lists and quotes |
| `document` | Everything: also strikethrough, code, tables, rules, `asset:` images and `doc:` links |

Raw HTML is never markup: it is the text written. Only `https:`, `mailto:`, `doc:`, `asset:` and site-relative links are kept; any other destination is its text.

### 6.2 Links and images

| Written | Rendered |
|---|---|
| `[text](doc:<uuid>)` | A link to the document's current address; its text alone when it is not published, or has no address |
| `![alt](asset:<id>)` | An `<img>` at the address the asset port answers, with the `alt`; nothing when the asset is unknown |

### 6.3 Drawing

The publisher draws nothing (§15). Readers receive safe trees, never HTML; whoever draws them uses `ui` or its own renderer, with the addresses the server resolved for that answer (`links`).

### 6.4 In answers

A rendered answer carries each formatted field as `richText`: `{ path, profile, nodes }`, in the order the type declares them, `path` naming the value in `fields` (`blocks[0].body`) and `nodes` its safe tree, checked against `richTextTreeSchema`. Never HTML.

### 6.5 Checks on save

Every formatted field of a version is normalised (NFC, `\n` line ends) and checked by its `richTextSchema` on create, save, restore, submission and import. Refused (`validation-failed`): anything beyond the profile (`not-in-profile`), a second paragraph in an inline field (`more-than-one-paragraph`), control characters (`unsafe-characters`), an image without alt text (`image-without-alt`) or from anywhere but `asset:` (`image-not-asset`), and any image when the host supplies no asset port (`images-unavailable`). Links are not refused: a link to an unpublished document renders as text until it is published.

## 7. Addresses and links

### 7.1 Resolution

`resolvePublisherPath({ path, viewer?, preview? })` answers what a request path is now: `{ kind: 'document', rendered }`, `{ kind: 'redirect', to, status: 301 }` or `{ kind: 'none' }`, for documents of every type. The public catch-all route (`publisher-document`, §15) calls it through `/api/publisher/resolve`. A path that is not a site path, a draft, and a document the viewer may not preview all answer `{ kind: 'none' }`, exactly as a missing document does.

### 7.2 Redirects

Publishing a version whose path differs from the published one's records a redirect from the old path to the document, and writes `publisher.address-changed`. Redirects point at the document, not at an address, so a second rename redirects every earlier address straight to the newest, never in a chain. A published document at a path wins over a redirect from it. A redirect answers only while its document is published.

### 7.3 Links between documents

`doc:` links are stored by id, from the newest and the published version of each document, so renaming the target never breaks them. `listPublisherBacklinks({ subject, documentId })` lists every document linking to one: all of them, with titles only where the viewer holds `view-draft` on the linking document's type. `unpublish` and `archive` carry `acknowledgedLinks`, the number of linking documents the editor was shown; fewer than there are now is `conflict`, `still-linked`, so nobody unpublishes something still linked without seeing it.

## 8. Reading

### 8.1 Listings

`listPublishedDocuments({ type, locale?, filters?, order?, limit?, offset? })` lists a listable type's published documents, by its default order unless another is asked, filtered by equality on its `filterable` fields (an array field matches when it contains the value), up to 100 at a time. A filter on any other field is `unknown-filter`; an unregistered or unlisted type `unknown-type`.

### 8.2 Feeds

`getPublisherFeed({ type, format, origin, limit? })` writes RSS 2.0 or Atom 1.0 of a listable type's newest published documents: titles and summaries escaped, addresses absolute from `origin` (an `https:` or `http:` origin, with no path or credentials; the endpoints pass the request's own), the feed's title the type's `label.many` through the title template. Documents without an address are entries identified by `urn:uuid:<id>`, without a link.

### 8.3 Sitemap entries

`listPublisherSitemapEntries({ siteId })` answers `{ path, lastModified, type }` for every published document with an address on the site. The host combines them with its own into `sitemap.xml`.

### 8.4 Who reads what

Only published documents are public, at their published version. A preview of the newest version (`preview: true`) needs the type's `view-draft`; without it, the answer is exactly that for a missing document (`null`, `{ kind: 'none' }`, HTTP 404). A personal-data type's `subjectField` and `consentField` are never in a reader's answer.

## 9. Personal data

For types declaring `personalData`:

- **Consent.** Publishing (by `publish` or `moderate`) refuses a version whose `consentField` is absent (`conflict`, `consent-missing`).
- **Export.** `exportPublisherPersonData({ identityId })` answers every document whose newest or any earlier version names the person in its `subjectField`, with every version, in the bundle's document form (§16).
- **Erasure.** `erasePublisherPerson({ identityId, correlationId })` deletes exactly those documents, every version of them, their links, redirects and approvals, writes `publisher.document-unpublished` (`erased`) for each that was published and `publisher.person-erased` with the counts. Linking documents survive; their links render as text. Erasing again erases nothing. A host calls both from iam-integration's data-subject request coordinator.
- **Retention.** `runPublisherMaintenance()` deletes superseded versions (neither the newest nor the published) saved longer ago than the type's `retentionDays`.
- `authors` on any type are opaque identifiers, anonymised by Profile's unlinking like every other member's.

## 10. Permissions

Derived for each registered type (`publisherPermissions(registry)`), for the host to add to Authorisation's catalogue:

| Permission | Floor | Personal-data floor | Allows |
|---|---|---|---|
| `publisher.<type>.view-draft` | `low` | `medium` | Reading drafts, history, links and administration lists of the type; previews |
| `publisher.<type>.edit` | `low` | `medium` | Creating, saving, submitting, withdrawing, reopening and restoring |
| `publisher.<type>.publish` | `medium` | `medium` | Publishing, scheduling, unpublishing and archiving |
| `publisher.<type>.moderate` | `medium` | `medium` | Accepting and rejecting submissions |

A type's `lifecycle.risks` may raise any of them; never lower (refused at start-up). The risk sets the step-up (§5.1) and, for `publish`, the approvers needed (§5.2).

## 11. Ports

| Port | Required | Supplied from | Purpose |
|---|---|---|---|
| Document types (`providePublisherDocumentTypes`) | Yes | Host | The registered types (§3) |
| `PublisherDatabase` | Yes | Host | PostgreSQL pool (runtime role), schema (default `publisher`), and optionally the migration pool and runtime role, under ADR-0002 and ADR-0006 |
| `PublisherSubjectResolver` | For the endpoints | Authentication, through the host | The signed-in subject, its `kind` and assurance, or `null` |
| `PublisherSiteResolver` | For the endpoints | Host, e.g. from Configuration's tenant by host name | The request's site (§3.4), or `null`; a host with one site answers a constant |
| `PublisherAccessDecision` | Yes | Authorisation, through the host | Whether an identity holds a permission (§10) now, for a type and optionally a document |
| `PublisherApproval` | For types with `approval` | iam-integration's approvals process, through the host | Asking for and reading consent to publish a version (§5.2) |
| `PublisherClock` | No: the system clock without it | Host (the suite's one clock) | Schedules, retention and assurance freshness |
| `PublisherEventSink` | For the relay | Host | Where `relayPublisherOutbox` sends events (§12) |
| `PublisherAssetResolver` | No: images are refused without it | The host's asset store | Each `asset:` id's address, or `null` |
| `PublisherTitleTemplate` | No: a document's title alone | Host, e.g. from Configuration's `seo.title-template` | Page and feed titles |

Required ports fail closed: a missing one is `PublisherCompositionError`, and a failing one `unavailable`, recording nothing. There is no in-memory or file store and no default type. `checkPublisherComposition()` checks every required port and the stored types at start-up.

## 12. Events

Written to the publisher's transactional outbox in the same transaction as the change, and relayed by the host (`relayPublisherOutbox`) to the event sink, at least once, in order. Every event has an `eventId` (UUIDv7), `type`, `occurredAt`, `correlationId` and `actorId` (`null` for maintenance and imports). Every event about a document, and `publisher.content-imported`, names its `siteId`.

| Event | Data |
|---|---|
| `publisher.document-created` | `documentId`, `type`, `version` |
| `publisher.document-saved` | `documentId`, `type`, `version`, `restoredFrom` |
| `publisher.review-requested` | `documentId`, `type`, `version`, `approvalId` |
| `publisher.review-withdrawn` | `documentId`, `type` |
| `publisher.document-scheduled` | `documentId`, `type`, `version`, `publishAt`, `unpublishAt` |
| `publisher.document-published` | `documentId`, `type`, `version`, `unpublishAt` |
| `publisher.document-unpublished` | `documentId`, `type`, `reasonCode` (`unpublished`, `archived`, `expired`, `erased`) |
| `publisher.document-reopened` | `documentId`, `type` |
| `publisher.address-changed` | `documentId`, `type`, `redirectRecorded` |
| `publisher.submission-received` | `documentId`, `type` |
| `publisher.submission-moderated` | `documentId`, `type`, `outcome` |
| `publisher.person-erased` | `identityId`, `documents`, `versions` |
| `publisher.content-imported` | `documents`, `versions` |
| `publisher.retention-applied` | `versions`, when a run deleted any |

Events carry identifiers, codes, counts and times only: never a title, a field, a path or a name (`publisherEventSchema` is strict). A consumer that needs content reads it through the server functions.

## 13. Server functions

Auto-imported in the host's server code. The subject is always the signed-in principal from the host's resolver, never from a request body.

| Function | Does |
|---|---|
| `migratePublisherDatabase()` | Applies append-only migrations through the migration pool, once, even when instances race |
| `checkPublisherComposition()` | §11, §3.3. A host calls it at start-up after migrating |
| `createPublisherDocument({ subject, type, content, correlationId })` | §5.1 |
| `transitionPublisherDocument({ subject, documentId, request, correlationId })` | Any action of §5.1 (`publisherActionRequestSchema`) |
| `receivePublisherSubmission({ type, submitterId, content, correlationId })` | §5.3. Server-only |
| `getPublisherDocument({ subject, documentId, version? })`, `listPublisherDocuments({ subject, type, search?, status?, limit?, offset? })`, `listPublisherHistory`, `listPublisherBacklinks`, `listPublisherModerationQueue` | Administration reads, under `view-draft` (the queue under `moderate`); anything else `forbidden` |
| `resolvePublisherPath`, `getPublishedDocument({ path } or { documentId }, viewer?, preview?)` | §7.1, §8.4 |
| `listPublishedDocuments`, `getPublisherFeed`, `listPublisherSitemapEntries` | §8 |
| `runPublisherMaintenance()` | §5.4, §9. Never an endpoint |
| `relayPublisherOutbox({ limit? })` | §12 |
| `exportPublisherContent({ siteId, types? })`, `importPublisherContent({ siteId, bundle, correlationId })` | §16. Server-only |
| `exportPublisherPersonData({ identityId })`, `erasePublisherPerson({ identityId, correlationId })` | §9. Server-only |

## 14. HTTP API

Under `/api/publisher`. Endpoints take the subject only from the host's resolver, parse queries and bodies with strict schemas, call the server functions (never SQL), are wrapped in one handler (`publisherHandler`), and answer errors as coarse codes. State-changing requests must carry an `Origin` on the request's own host.

| Method and path | Access | Does |
|---|---|---|
| `GET /resolve?path=…&preview=1` | Anyone; a preview needs `view-draft` | §7.1. A preview is `Cache-Control: private, no-store` |
| `GET /documents?type=…&…` | Anyone | §8.1; every other query parameter is a filter |
| `GET /feeds/{type}/rss`, `GET /feeds/{type}/atom` | Anyone | §8.2, with the request's own origin |
| `GET /admin/types` | Signed in | The types the subject holds any permission on, with each type's form schema |
| `GET /admin/documents?type=…&search=…&status=…`, `POST /admin/documents` | `view-draft`; `edit` | Lists; creates (201) |
| `GET /admin/documents/{id}?version=…` | `view-draft` | §5.5 |
| `POST /admin/documents/{id}/actions` | §5.1 | One action (`publisherActionRequestSchema`) |
| `GET /admin/documents/{id}/history`, `/backlinks`, `/preview` | `view-draft` | §5.5, §7.3, §8.4 |
| `GET /admin/moderation` | `moderate` | §5.3 |

Export, import, submissions, erasure, maintenance and the relay are never endpoints.

### 14.1 Errors

| Code | HTTP | Meaning |
|---|---|---|
| `unauthenticated` | 401 | No signed-in subject |
| `forbidden` | 403 | Refused. Never says whether a document exists, or which rule refused |
| `not-found` | 404 | Nothing a reader may see here: missing, draft or erased alike |
| `insufficient-assurance` | 403 | The subject must step up to the permission's risk |
| `validation-failed` | 400 | Malformed; one problem code (`PUBLISHER_CONTENT_PROBLEMS`, or a field schema's code), never a value |
| `conflict` | 409 | A rule refused it (`PUBLISHER_CONFLICT_REASONS`) |
| `unavailable` | 503 | Database, registration, port or clock failure. Fails closed |

## 15. Headless surface

The publisher draws nothing (ADR-0009): no pages, routes, components, slots, styles or display wording. `tests/headless.test.ts` holds it to that.

| It offers | For |
|---|---|
| The contract (`./contracts`) | Types, schemas and the lifecycle table |
| Server functions (§13) | Every task, for the host's server |
| The HTTP API (§14) | The same tasks, for browsers and other services |
| `usePublisher()` | A typed client for the host's own screens: data and actions only; `publisherErrorOf` reads a failure's code |
| Safe trees (§6.4), feeds and sitemap entries (§8) | Content and data formats that are safe to draw |
| Events (§12) | What happened |

The host, a kit or `ui` draws everything:

| The host's screens | Do |
|---|---|
| Routes | Ask `resolve` what an address holds; answer a redirect with 301 and a missing or hidden document with 404 |
| Metadata | Set title, description, canonical URL, Open Graph and `noindex` on a preview from the answer's `head` |
| Content | Draw each `richText` tree with `ui`, links through the answer's `links`; never as HTML |
| Editing | Use `content-editor`, or plain form controls; the server checks every save |
| Names | Ask Profile for an author's name by identity identifier |
| Administration | Never framed, cached or sent as a Referer; one `<main>` per screen; accessibility tested in light and dark mode |

## 16. Export and import

`exportPublisherContent({ siteId, types? })` answers a site's `{ format: 'nuxt4-layers.publisher', version: 1, exportedAt, types, documents }`: each document's envelope, every version's content and the redirects to it (`publisherBundleSchema`). `importPublisherContent` takes such a bundle into a site of a database where none of its documents exists (`conflict` otherwise), checking every version against its registered type as a save would (`unknown-type`, field and Markdown problems), all or nothing, and writes `publisher.content-imported`. Importing an export into an empty database gives identical content. A bundle names no site, so a site's content moves to another site or environment unchanged. An import is also how a host seeds content; it bypasses no check on content, and needs no subject because it is server-only.

## 17. Versioning

Contract version 1 (`PUBLISHER_CONTRACT_VERSION`), frozen for 1.x once 1.0.0 is released. Adding a port, an optional declaration field, an export, an event or a lifecycle feature is a minor release; removing or narrowing a type, function, endpoint, event or port, lowering a floor, or a stricter rule a host must act on needs contract version 2. `tests/contracts.test.ts` pins version 1's exports. Before 1.0.0, the contract changes only by reviewed pull request.

## 18. Decisions

1. **Status belongs to the document.** A published document stays `published` while a newer version is saved or awaits approval (`latestVersion`, `reviewVersion`); readers see `publishedVersion` until the next publish. `in-review` is for documents not yet public.
2. **Approval or moderation, not both.** Moderation is the review of submissions; a type with both would ask two processes for one decision.
3. **Submissions are server-only.** Who may submit (anyone, signed-in people, customers who bought something) is the host's form handling's decision; the publisher only keeps submissions hidden until moderated.
4. **Unpublishing returns to draft; an `unpublishAt` archives.** An editor taking a document down usually means to change it; a scheduled end means the document has run its course.
5. **One address space.** Paths are unique across types and locales; a translation is its own document at its own address. Locale-aware routing, if any, is the host's.
6. **Uniqueness on publishing.** Drafts may share an address, so an editor can prepare a replacement; publishing claims it.
7. **Redirects follow the document.** No chains; a document wins over a redirect; a redirect dies with its document's publication.
8. **Backlinks by acknowledgement.** Unpublishing a linked document is allowed, but only once the editor has seen how many documents link to it.
9. **The access port is type-wide.** The publisher asks about a permission, a type and optionally a document; which group or tenant decides is the host's mapping to Authorisation.
10. **Sites from the start.** Every document belongs to a site (§3.4), so a host serving several tenants composes the layer once, and a host with one site answers a constant. Adding a site scope after 1.0.0 would have narrowed every query and port, a contract version 2.
11. **Rich text to a safe tree.** `rich-text`'s parser answers its own nodes, rendered to VNodes; there is no sanitiser to get wrong because markup never reaches the DOM.
12. **No document type in the layer.** Not even for its own tests or playground: both register types defined in `tests/support/types.ts`.
