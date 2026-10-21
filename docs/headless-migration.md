# Headless Migration Plan

> **In short:** keep every service, remove every screen, and hand rich text to the shared `rich-text` library. The publisher is not yet released, so this all happens before 1.0.0, with no deprecation period.

Governed by [ADR-0009](https://github.com/nuxt4-layers/platform-architecture/blob/667e5310a66c56327f0ef80d43ce01b573ce6d86/docs/decisions/ADR-0009-headless-capability-layers.md) (headless layers) and [ADR-0011](https://github.com/nuxt4-layers/platform-architecture/blob/667e5310a66c56327f0ef80d43ce01b573ce6d86/docs/decisions/ADR-0011-shared-rich-text-and-configurable-copy.md) (shared rich text). The result is described in the [guide](guide.md).

## Starting point

`master` holds the untagged 1.0.0 candidate: every service, every document on a site, its own Markdown dialect, and screens with an editor slot.

## What stays, changes and goes

| Part | Today | After |
|---|---|---|
| Contract, server functions, storage, events, ports | Headless already | **Stays** |
| Sites | Every document on a site | **Stays** |
| HTTP API `/api/publisher/*` | Always on | **Stays**, with `publisher: { api: { enabled } }` to switch it off |
| `usePublisher()` | Data client, plus screen helpers | **Stays** as a typed client only |
| Markdown dialect | The publisher's own (`markdown/`, `shared/markdown.ts`) | **Moves** to `nuxt4-layers/rich-text`, with profiles added |
| Formatted fields | `markdownSchema()` and `markdownFields` in each type | **Changes:** fields use `rich-text`'s schema with a **profile** (inline, block or document); the publisher finds them from the schema |
| Plain fields | Strings in each type's schema | **Stays:** plain strings with a length limit, never `rich-text` |
| Checks on save | The publisher's own | **Changes:** `rich-text`'s checks, against each field's profile |
| `PublisherRendered.markdown` | `string[]` | **Changes:** `richText`, `{ path, profile, nodes }[]`: `rich-text`'s safe tree for each formatted field |
| Screens: catch-all route, administration, moderation | `app/publisher-pages/`, `modules/publisher-routes.ts` | **Go** to the host, or a kit |
| Components, renderer | `app/components/`, `publisher-markdown-render.ts` | **Go:** drawing safe trees is `ui`'s; editing is `content-editor`'s |
| Wording, class map, pairings | `publisher-messages.ts`, `publisher-classes.ts`, `publisher-pairings.ts` | **Go** to `ui` or the host |
| Slots: renderer, editor, person name | `publisher-components.ts`, `providePublisherEditor` | **Go**: the host composes these itself |
| Styling | `tailwind.css`, Theme Manager dependency | **Go** |
| Browser and axe tests | `tests/e2e/`, Playwright | **Go** to `ui`, `content-editor`, a kit or the host |

## Before it starts

`nuxt4-layers/rich-text` must exist at 1.0, built from the publisher's dialect with its tests, and with profiles added. The publisher pins it by tag ([ADR-0008](https://github.com/nuxt4-layers/platform-architecture/blob/667e5310a66c56327f0ef80d43ce01b573ce6d86/docs/decisions/ADR-0008-independent-layer-delivery.md)).

## Steps

Each step is a commit: its contract and tests first, then the code.

1. **Adopt `rich-text`.** Depend on it; replace `markdownSchema()`, `markdownFields` and the dialect's constants with its schema and profiles; check every save against each formatted field's profile; remove `markdown/` and `shared/markdown.ts`. Tests: a formatted field refuses anything beyond its profile, by any route, including import; a plain field is never read as rich text. **Done.**
2. **Safe trees in answers.** Replace `PublisherRendered.markdown` with `richText`, `{ path, profile, nodes }[]`, using `rich-text`'s tree, for formatted fields only. Tests: nothing unsafe ever appears in an answer. **Done.**
3. **A headless test.** Replace `tests/presentation.test.ts` with one that fails while the layer ships pages, components, routes, styles, display wording or slots.
4. **Remove the screens.** Delete `app/` except the typed client, `modules/publisher-routes.ts`, `tailwind.css`, the Theme Manager dependency, Playwright and `tests/e2e/`. The playground becomes a server-only host that the HTTP tests can use.
5. **Switchable API.** Add `publisher.api.enabled` (default on); when off, `/api/publisher/*` answers 404. Test both.
6. **Documents.** The contract's dialect section points at `rich-text`; §15 becomes "Headless surface"; the threat model's XSS and framing controls point at the safe tree and the host; the guide, README, roadmap and `CLAUDE.md` follow ADR-0009, ADR-0010 and ADR-0011.
7. **Release.** Tag `v1.0.0`: contract version 1, headless.

## Risks

| Risk | Treatment |
|---|---|
| The publisher waits on `rich-text` | Its dialect and tests already exist; extracting them is small. Steps 3 to 5 can go first if it is late |
| A field's profile chosen too loosely | Profiles are declared per field and reviewed with each type; ADR-0011 makes loosening one an ADR |
| No screens until a host or kit draws them | The guide shows the host's route |
| A presenter draws content unsafely | Content arrives only as safe trees; raw HTML never leaves the layer |
| Accessibility no longer tested here | Moves to `ui`, `content-editor` and the host, per ADR-0009 |
