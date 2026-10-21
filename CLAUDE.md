# @nuxt4-layers/publisher — notes for Claude

## What this is
Nuxt 4 foundation layer for publishing documents of types the host registers: drafts, versions and history; approval and moderation; scheduling; addresses, redirects and links; safe Markdown; listings and feeds. Governed by `nuxt4-layers/platform-architecture`; persistence follows ADR-0002 and ADR-0006. Not a member of the IAM suite. British spelling everywhere, including code and the manifest.

## Commands
- `pnpm install`, then `pnpm dev:prepare` for Nuxt types. Never add a `prepare`/`postinstall` script
- `pnpm check` = `nuxt typecheck` + `vitest run`; run it after every code change. Single file: `pnpm vitest run tests/<name>.test.ts`
- Database suites need `PUBLISHER_TEST_DATABASE_URL` (admin URL of a local, disposable PostgreSQL 16); they skip locally without it and fail in CI
- `pnpm build:playground` proves the layer composes in a host
- Browser tests: `pnpm test:e2e` (builds the playground, then Playwright with axe in light and dark mode, port 3443). Needs `PUBLISHER_TEST_DATABASE_URL`; locally set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Playwright's own browser is not installed
- Theme Manager is pinned as `git+https://github.com/nuxt4-layers/theme-manager.git#<sha>`; the lockfile must record the `codeload.github.com` tarball, never `git@github.com`
- Never edit a released migration in `server/database/migrations.ts`; add a new one
- `python3 scripts/check_markdown.py` checks headings, local links and that links to other `nuxt4-layers` documents are pinned to a tag or commit. Run it after every documentation change.

## Rules
- **The layer never names a document type.** Every type is the host's registration (`providePublisherDocumentTypes`); adding one is never a change to the layer. No `page`, `post`, `review`, `menu` or `blog` (or any other type) in `app/`, `server/`, `shared/`, `markdown/`, `modules/` or messages, outside comments; `tests/contracts.test.ts` searches for them. Reference types live only in `examples/`, never registered; tests and the playground use the types in `tests/support/types.ts`.
- Every document belongs to a site (docs/contracts.md §3.4): every scoped query, port call and event names it; endpoints take it only from the host's site resolver. Nothing crosses sites.
- The layer builds no editing form: editing content is the editor slot's (`content-editor`); without one, the screens are read-only.
- Publishing only. Never store site settings (Configuration's), files (the host's asset store), names (Profile's), permissions or approvals policy (the IAM suite's), or the site shell.
- Required ports fail closed. No implicit in-memory or file store, no default type, no default key.
- Contract (`shared/`) imports only zod; enforced by `tests/contracts.test.ts`. `server/internal` and `server/database` are private. Every row is parsed with the contract's schemas before it leaves the layer; SQL is parameterised.
- One state machine (`PUBLISHER_TRANSITIONS`) for every type; every action carries `expectedVersion` and is checked through the access-decision port. Types with `approval` publish only with the approval port's consent to that version's digest.
- Only published documents are public. A draft, without `view-draft`, answers exactly as a missing document.
- Markdown is parsed into the dialect's own tree and rendered to VNodes. Never `v-html`, `innerHTML` or raw HTML; only `https:`, `mailto:`, `doc:`, `asset:` and site-relative links are kept.
- Personal-data types: consent recorded before publishing; export and erasure by the person's identifier cover every version; superseded versions follow the retention period.
- Events and logs carry identifiers, codes, counts and times only, written to the outbox in the same transaction as the change.
- Endpoints (`server/api/publisher/`) take the subject only from the host's resolver; parse queries and bodies strictly; call the server functions, never SQL; are wrapped in `publisherHandler`. `tests/http.test.ts` mounts every file and pins the list. Export, import, submissions, erasure, maintenance and the relay are never endpoints.
- Pages and components (`app/`) reach the server only through `usePublisher()`; never `$fetch` or `/api/` in a component or page. Text comes from `app/publisher-messages.ts` via `usePublisherText()`. Style only through `publisherClasses`; any cross-role pairing goes in `app/publisher-pairings.ts` and docs/contracts.md §15. Every screen has one `<main>`; the routes module (`modules/publisher-routes.ts`) names admin screens `publisher-admin-*` and the catch-all `publisher-document`. Never weaken an axe or contrast assertion to get green.
- Members and other layers are reached only through ports the host supplies; never import another `@nuxt4-layers/*` package.
- Keep `docs/contracts.md`, `docs/threat-model.md` (control register) and `docs/roadmap.md` in step with code, briefly. Link to other `nuxt4-layers` documents pinned to a commit.
- Contract version 1 is frozen for 1.x once 1.0.0 ships (docs/contracts.md §17); additions are minor releases.
- Built test-first: a new feature's contract and failing tests come first. Anything specified but not yet built calls `pending()` (`shared/pending.ts`); `tests/contracts.test.ts` fails while any call remains, so no release ships one.
- Platform-agnostic: the layer and its tests run alike on Windows, macOS and Linux. Tests that compare file paths with import specifiers or routes pass them through `toPosix` (`tests/support/paths.ts`).
- Package manager: pnpm. Commit `pnpm-lock.yaml`.
