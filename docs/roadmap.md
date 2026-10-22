# Roadmap

The layer was specified and tested before it was built, phase by phase on one pull request. Each phase keeps the [contract](contracts.md) and the [threat model](threat-model.md) in step with the code, and turned more of the acceptance tests green, until all passed at 1.0.0.

## Phase 0: contract and failing tests (done)

- The README, the contract (boundaries, the type-declaration meta-schema, the envelope, the lifecycle, the Markdown dialect, ports, permissions, events, server functions, HTTP API, presentation, versioning and decisions) and the threat model.
- `shared/`: every schema, the lifecycle table and the dialect's constants, importing only zod. Server functions, composition and the Markdown parser as typed signatures that throw.
- Reference declarations in `./examples`, never registered.
- The acceptance tests, failing: generality across types defined only in the tests, registration, lifecycle, approval, moderation, scheduling, versions, addresses and links, Markdown, personal data, export and import, events, the database's rules, ports failing closed, HTTP, presentation, and every page in a browser with axe in light and dark mode.
- The playground host and CI.

## Phase 1: registry and storage (done)

- `buildPublisherRegistry`, the permissions, and the composition registry with its ports failing closed.
- Append-only migrations, the runtime role, the outbox and its relay.
- Green: `tests/contracts.test.ts` (registration), `tests/composition.test.ts`, `tests/migrations.test.ts`.

## Phase 2: the lifecycle (done)

- Documents, versions and history; the state machine; approval through the port; moderation; scheduling and `runPublisherMaintenance`; personal data, export and erasure; the bundle.
- Green: `tests/lifecycle.test.ts`, `tests/personal-data.test.ts`, `tests/bundle.test.ts`, `tests/events.test.ts`.

## Phase 3: Markdown, addresses and reading (done)

- The dialect's parser and checks; links by id, backlinks, redirects and resolution; listings, feeds, sitemap entries and metadata.
- Green: `tests/markdown.test.ts` (parser), `tests/addresses.test.ts`, `tests/reading.test.ts`.

## Phase 4: endpoints and presentation (done)

- `/api/publisher/*`, `usePublisher()`, the catch-all route, the renderers, `PublisherMarkdown`, the not-found component, and the administration pages; Theme Manager's vocabulary.
- Green: `tests/http.test.ts`, `tests/presentation.test.ts`, `tests/markdown.test.ts` (rendering), `tests/e2e/pages.spec.ts`.

## Phase 5: contract version 1 (done)

- Every test green and nothing pending; the threat model's controls implemented; the package at 1.0.0.
- The rendered answer carries the type's Markdown sources in order (`markdown`), for the generic renderer; the routes module's option is `administration` (screens named `publisher-admin-*`).
- Before tagging 1.0.0: sites from the start (§3.4), so tenants need no contract version 2; and editing left wholly to `content-editor` through the editor slot (§15.2), the layer building no form of its own.
- Composition into `steve-r-lewis/platform-test-harness` follows, outside this repository.

## Headless migration, step 1: adopt `rich-text` (done)

- `@nuxt4-layers/rich-text` pinned at `v1.0.0`; the publisher's own dialect, `markdownSchema()` and `markdownFields` removed.
- Formatted fields are found from each type's schema and checked against their profiles on every save, submission and import.
- Green: `tests/rich-text.test.ts`, `tests/contracts.test.ts` "registration", and the browser tests. Next: [step 2](headless-migration.md).

## Headless migration, step 2: safe trees in answers (done)

- A rendered answer carries `richText`, each formatted field's `{ path, profile, nodes }`, in place of its sources (`markdown`).
- Green: `tests/rich-text.test.ts` "answers formatted fields as safe trees", and the browser tests.

## Headless migration, steps 3 and 4: headless, screens removed (done)

- `tests/headless.test.ts` replaces the presentation tests: no screens, routes, components, slots, styles, display wording or design-system dependency; `usePublisher()` holds data and actions only.
- Removed: the pages, components, renderers, slots, routes module, wording, class map, pairings, `tailwind.css`, Theme Manager, Playwright and the browser tests. The playground is a server-only host.
- Also: `rich-text` pinned at `v2.0.0`, which normalises formatted text itself. Next: [step 5](headless-migration.md), the switchable API.
