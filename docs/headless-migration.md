# Headless Migration Plan

> **In short:** keep every service, remove every screen. The publisher is not yet released, so it becomes headless before 1.0.0 with no deprecation period.

Governed by [ADR-0009](https://github.com/nuxt4-layers/platform-architecture/blob/725b2ffdc2f8101420bf301630f98fff01f68bc2/docs/decisions/ADR-0009-headless-capability-layers.md). The result is described in the [guide](guide.md).

## Starting point

`master` holds the untagged 1.0.0 candidate: every service, every document on a site, and screens with an editor slot.

## What stays, changes and goes

| Part | Today | After |
|---|---|---|
| Contract, server functions, storage, events, ports | Headless already | **Stays** |
| Sites | Every document on a site | **Stays** |
| HTTP API `/api/publisher/*` | Always on | **Stays**, with `publisher: { api: { enabled } }` to switch it off |
| `usePublisher()` | Data client, plus screen helpers | **Stays** as a typed client only |
| Markdown | Source strings; rendered to VNodes by the layer | **Changes:** answers carry each field's **safe tree**; the parser is a public `./markdown` export |
| `PublisherRendered.markdown` | `string[]` | **Changes:** `{ path, nodes }[]`, with the tree's schema in the contract |
| Screens: catch-all route, administration, moderation | `app/publisher-pages/`, `modules/publisher-routes.ts` | **Go** to the host, or a kit |
| Components, renderer, form | `app/components/`, `publisher-markdown-render.ts` | **Go** to `ui` |
| Wording, class map, pairings | `publisher-messages.ts`, `publisher-classes.ts`, `publisher-pairings.ts` | **Go** to `ui` or the host |
| Slots: renderer, editor, person name | `publisher-components.ts`, `providePublisherEditor` | **Go**: the host composes these itself |
| Styling | `tailwind.css`, Theme Manager dependency | **Go** |
| Browser and axe tests | `tests/e2e/`, Playwright | **Go** to the kit or the host |

## Steps

Each step is a commit: its contract and tests first, then the code.

1. **Safe trees in the contract.** Add the Markdown tree schema to `shared/`; change `PublisherRendered.markdown` to `{ path, nodes }[]`; export the parser and checks from `./markdown`. Tests: trees for every construct, and nothing unsafe ever appears in one.
2. **A headless test.** Replace `tests/presentation.test.ts` with one that fails while the layer ships pages, components, routes, styles, display wording or slots.
3. **Remove the screens.** Delete `app/` except the typed client (including the editor slot), `modules/publisher-routes.ts`, `tailwind.css`, the Theme Manager dependency, Playwright and `tests/e2e/`. The playground becomes a server-only host that the HTTP tests can use.
4. **Switchable API.** Add `publisher.api.enabled` (default on); when off, `/api/publisher/*` answers 404. Test both.
5. **Documents.** Contract §15 becomes "Headless surface"; the threat model's XSS and framing controls point at the safe tree and the host; README, roadmap and `CLAUDE.md` follow ADR-0009 and ADR-0010.
6. **Release.** Tag `v1.0.0`: contract version 1, headless.

## Risks

| Risk | Treatment |
|---|---|
| No screens until a host or kit draws them | The guide shows the host's route; a publishing kit follows when a second application needs it |
| A presenter draws content unsafely | Content arrives only as safe trees; raw HTML never leaves the layer |
| Accessibility no longer tested here | Moves to `ui` and the host, per ADR-0009 |
| Lost work from the screens | Kept in git history, and a starting point for the kit |
