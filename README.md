# @nuxt4-layers/publisher

Nuxt 4 foundation layer for publishing: which version of which document is published at which address, for whom, now. It owns the lifecycle every published document shares (drafts, versions and history; review, approval and moderation; scheduled publishing and unpublishing; addresses, redirects and links between documents; safe rich text; listings and feeds) and knows nothing about what any document is. Every document type is the host's registration.

A headless platform foundation layer (ADR-0009): it draws nothing. It reaches Authorisation, the approvals process, the asset store and the title template only through ports the host supplies, and imports no other layer, only the stateless `rich-text` library.

**Composing it?** Read [CONTRACT.md](CONTRACT.md), the one-page host contract, and nothing else ([changelog](CHANGELOG.md)).

**Status:** 1.0.0, contract version 1 ([guide](docs/guide.md), [contract](docs/contracts.md), [threat model](docs/threat-model.md), [roadmap](docs/roadmap.md), [headless migration, complete](docs/headless-migration.md)): headless: the lifecycle, rich text checked by profile, addresses and links, listings and feeds, personal data, export and import, a switchable HTTP API and a typed client, with every document on a site, proven against types defined only in the tests. Composition into an application happens in `steve-r-lewis/platform-test-harness`.

## Owns

- The lifecycle of documents of the types a host registers, and every version of each.
- The addresses of published documents, the redirects from their old addresses and the links between documents, by id.
- Checking every formatted field against its profile on save, using the shared `rich-text` format (ADR-0011), and rendering it safely.
- Listings, RSS and Atom feeds, and sitemap entries.

## Never owns

| Not here | Owned by |
|---|---|
| Any particular document type (pages, posts, menus, reviews …) | The host, by registration |
| Site name, legal entity, contacts, SEO defaults, `security.txt` | The host, from Configuration |
| The site shell, routes, every screen, contact forms and sending mail | The host, a kit or `ui` |
| Images and files | The host's asset store: the publisher holds references only |
| People's names | Profile, asked by the host's screens |
| Who may do what, and approvals | The IAM suite, through the access-decision and approval ports |
| Editing content: forms, rich-text editing, authoring | `content-editor`, or the host's own form controls; the server checks every save |

## Interfaces

| Direction | Interface | Purpose |
|---|---|---|
| Consumes from the host | `providePublisherDocumentTypes` | The document types: fields (formatted ones by profile), address, listing, lifecycle, personal data |
| Consumes from the host | Database, subject resolver, access decision, approval, clock, event sink, asset resolver, title template | Storage under ADR-0002; the signed-in subject; permissions; consent to publish; time; events; images; titles |
| Provides to the host's screens | The HTTP API and `usePublisher()`, its typed client | Data and actions; content as `rich-text` safe trees |
| Provides to the host's server | `getPublishedDocument`, `listPublishedDocuments`, feeds, sitemap entries, export and import, personal-data export and erasure, maintenance | Reading, seeding and data-subject requests |
| Publishes | `publisher.*` events | Identifiers, codes and times only |

## Development

`pnpm install`, `pnpm dev:prepare`, then `pnpm check` (type check and tests). Database suites need `PUBLISHER_TEST_DATABASE_URL`, the admin URL of a disposable PostgreSQL 16. `python3 scripts/check_markdown.py` checks the documentation.

## Governing decisions and specifications

- [ADR-0002 — Composition-Supplied Persistence and Capability-Owned Schemas](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0002-composition-supplied-persistence-and-capability-owned-schemas.md)
- [ADR-0004 — Documentation Placement](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0004-documentation-placement.md)
- [ADR-0006 — Polyglot Persistence and Data-Store Security](https://github.com/nuxt4-layers/platform-architecture/blob/93f3d6fb144b72d61cfb172b6a50eb6c5af9f489/docs/decisions/ADR-0006-polyglot-persistence-and-data-store-security.md)
- [ADR-0009 — Headless Capability Layers](https://github.com/nuxt4-layers/platform-architecture/blob/725b2ffdc2f8101420bf301630f98fff01f68bc2/docs/decisions/ADR-0009-headless-capability-layers.md)
- [ADR-0010 — Documentation Style](https://github.com/nuxt4-layers/platform-architecture/blob/725b2ffdc2f8101420bf301630f98fff01f68bc2/docs/decisions/ADR-0010-documentation-style.md)
- [ADR-0011 — Shared Rich Text and Configurable Copy](https://github.com/nuxt4-layers/platform-architecture/blob/667e5310a66c56327f0ef80d43ce01b573ce6d86/docs/decisions/ADR-0011-shared-rich-text-and-configurable-copy.md)
- [Approvals (two-person rule)](https://github.com/nuxt4-layers/iam-integration/blob/899befcf566775950c4b70b8cf0e7658be1000f9/docs/processes/approvals.md)
