# Roadmap

The layer is specified and tested before it is built. Each phase is its own pull request, keeps the [contract](contracts.md) and the [threat model](threat-model.md) in step with the code, and turns more of the acceptance tests green, until all pass at 1.0.0.

## Phase 0: contract and failing tests

- The README, the contract (boundaries, the type-declaration meta-schema, the envelope, the lifecycle, the Markdown dialect, ports, permissions, events, server functions, HTTP API, presentation, versioning and decisions) and the threat model.
- `shared/`: every schema, the lifecycle table and the dialect's constants, importing only zod. Server functions, composition and the Markdown parser as typed signatures that throw.
- Reference declarations in `./examples`, never registered.
- The acceptance tests, failing: generality across types defined only in the tests, registration, lifecycle, approval, moderation, scheduling, versions, addresses and links, Markdown, personal data, export and import, events, the database's rules, ports failing closed, HTTP, presentation, and every page in a browser with axe in light and dark mode.
- The playground host and CI.

## Phase 1: registry and storage

- `buildPublisherRegistry`, the permissions, and the composition registry with its ports failing closed.
- Append-only migrations, the runtime role, the outbox and its relay.
- Green: `tests/contracts.test.ts` (registration), `tests/composition.test.ts`, `tests/migrations.test.ts`.

## Phase 2: the lifecycle

- Documents, versions and history; the state machine; approval through the port; moderation; scheduling and `runPublisherMaintenance`; personal data, export and erasure; the bundle.
- Green: `tests/lifecycle.test.ts`, `tests/personal-data.test.ts`, `tests/bundle.test.ts`, `tests/events.test.ts`.

## Phase 3: Markdown, addresses and reading

- The dialect's parser and checks; links by id, backlinks, redirects and resolution; listings, feeds, sitemap entries and metadata.
- Green: `tests/markdown.test.ts` (parser), `tests/addresses.test.ts`, `tests/reading.test.ts`.

## Phase 4: endpoints and presentation

- `/api/publisher/*`, `usePublisher()`, the catch-all route, the renderers, `PublisherMarkdown`, the not-found component, and the administration pages; Theme Manager's vocabulary.
- Green: `tests/http.test.ts`, `tests/presentation.test.ts`, `tests/markdown.test.ts` (rendering), `tests/e2e/pages.spec.ts`.

## Phase 5: contract version 1

- Every test green and nothing pending; the threat model's controls marked implemented; the package at 1.0.0, released with notes.
- Composition into `steve-r-lewis/platform-test-harness` follows, outside this repository.
