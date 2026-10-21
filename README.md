# @nuxt4-layers/publisher

Nuxt 4 foundation layer for publishing: which version of which document is published at which address, for whom, now. It owns the lifecycle every published document shares (drafts, versions and history; review, approval and moderation; scheduled publishing and unpublishing; addresses, redirects and links between documents; safe Markdown; listings and feeds) and knows nothing about what any document is. Every document type is the host's registration.

A platform foundation layer. It reaches Authorisation, the approvals process, the asset store, the title template, the editor and people's names only through ports the host supplies, and never imports another layer.

**Status:** phase 0, contract version 1 drafted ([contract](docs/contracts.md), [threat model](docs/threat-model.md), [roadmap](docs/roadmap.md)): the contract and the failing acceptance tests. Not yet usable.

## Owns

- The lifecycle of documents of the types a host registers, and every version of each.
- The addresses of published documents, the redirects from their old addresses and the links between documents, by id.
- The shared Markdown dialect, agreed with `content-editor`, and rendering it safely.
- Listings, RSS and Atom feeds, and sitemap entries.

## Never owns

| Not here | Owned by |
|---|---|
| Any particular document type (pages, posts, menus, reviews …) | The host, by registration |
| Site name, legal entity, contacts, SEO defaults, `security.txt` | The host, from Configuration |
| The site shell, contact forms and sending mail | The host |
| Images and files | The host's asset store: the publisher holds references only |
| People's names | Profile, through the host's person-name component |
| Who may do what, and approvals | The IAM suite, through the access-decision and approval ports |
| The editing component | `content-editor`, through the editor slot |

## Interfaces

| Direction | Interface | Purpose |
|---|---|---|
| Consumes from the host | `providePublisherDocumentTypes` | The document types: fields, Markdown fields, address, listing, lifecycle, personal data |
| Consumes from the host | Database, subject resolver, access decision, approval, clock, event sink, asset resolver, title template | Storage under ADR-0002; the signed-in subject; permissions; consent to publish; time; events; images; titles |
| Consumes from the host (app side) | Renderer per type, editor, person name | Drawing documents, editing Markdown, naming authors |
| Provides to pages | `usePublisher()`, the `publisher-document` catch-all route, `PublisherMarkdown`, administration pages | Rendering, metadata, editing and moderation |
| Provides to the host's server | `getPublishedDocument`, `listPublishedDocuments`, feeds, sitemap entries, export and import, personal-data export and erasure, maintenance | Reading, seeding and data-subject requests |
| Publishes | `publisher.*` events | Identifiers, codes and times only |

## Development

`pnpm install`, `pnpm dev:prepare`, then `pnpm check` (type check and tests). Database suites need `PUBLISHER_TEST_DATABASE_URL`, the admin URL of a disposable PostgreSQL 16. `pnpm test:e2e` builds the playground and runs the browser tests. `python3 scripts/check_markdown.py` checks the documentation.

## Governing decisions and specifications

- [ADR-0002 — Composition-Supplied Persistence and Capability-Owned Schemas](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0002-composition-supplied-persistence-and-capability-owned-schemas.md)
- [ADR-0004 — Documentation Placement](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0004-documentation-placement.md)
- [ADR-0006 — Polyglot Persistence and Data-Store Security](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0006-polyglot-persistence-and-data-store-security.md)
- [Approvals (two-person rule)](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/approvals.md)
