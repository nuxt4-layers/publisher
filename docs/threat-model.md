# Threat Model

The publisher decides what a site says in public, so its first duty is that nothing is public unless it was meant to be: no draft, no unapproved version, no unmoderated submission, and no markup an editor or a submitter smuggled in. This register follows the [Data Store Security Standard v0.1](https://github.com/nuxt4-layers/platform-architecture/blob/1a6d9da53c4957ff16ae7a28269c49a39d23cff2/docs/standards/data-store-security-v01.md) and ADR-0006. Status is the state of the implementation; the evidence is the test that proves each control.

## 1. Assets

- Published content, and the integrity of what is published at each address.
- Drafts, unpublished versions and pending submissions, which are not public.
- Personal data in the documents of types that declare it: a person's words, rating or identity, and their consent.
- The registered types, which decide what may be stored.
- The outbox, history and redirects.

## 2. Trust boundaries

| Boundary | Trusted input | Untrusted input |
|---|---|---|
| Browser → host → publisher | The signed-in subject, from the host's resolver | Every identifier, path, query and body; every Markdown source; the request's origin |
| Host → publisher at start-up | The type declarations and ports the host supplies, checked before use | — |
| Publisher → access and approval ports | Their answers, parsed; a failure refuses the action | — |
| Publisher → asset port | Each asset's address, parsed as an `https` URL or site path | — |
| Host's forms → `receivePublisherSubmission` | That the host decided the submitter may submit | The submission's content |
| Host → database | The publisher's schema, through a runtime role that owns nothing | Other capabilities' schemas (never read) |

## 3. Control register

| ID | Threat | Control | Evidence | Status |
|---|---|---|---|---|
| T1 | A draft, an unpublished version or an archived document is shown to readers | Readers get only the published version of published documents; a preview needs `view-draft`, checked at every request | `tests/lifecycle.test.ts` "visibility" | Implemented |
| T2 | Whether a draft exists is learnt by probing | A draft, an erased document and a missing one answer identically (`null`, `none`, 404, the same page) | lifecycle "answers exactly as a missing document"; `tests/http.test.ts`; `tests/e2e/pages.spec.ts` | Implemented |
| T3 | A version is published without the required second person | Types with `approval` publish only with the approval port's `approved` answer, bound to the version's digest, with enough approvers other than the requester and publisher; a later save asks again | lifecycle "never publishes a type needing review" | Implemented |
| T4 | An action by someone without the permission, or with a weak sign-in | Every action checked through the access-decision port at `strong` consistency, per type; step-up to the permission's risk (`meetsStepUp`) | lifecycle "permissions and assurance" | Implemented |
| T5 | A type declared with a risk too low, or a lax schema | The meta-schema and `buildPublisherRegistry` refuse at start-up: floors, strict objects, bounded strings and arrays | `tests/contracts.test.ts` "registration"; `tests/composition.test.ts` | Implemented |
| T6 | Stored script, event handlers or `javascript:`/`data:` links run in readers' browsers (XSS) | Markdown parsed to the dialect's own tree and rendered to VNodes; raw HTML is text; only `https:`, `mailto:`, `doc:`, `asset:` and site paths kept; no `v-html` or `innerHTML` in the layer | `tests/markdown.test.ts`; `tests/presentation.test.ts`; e2e "renders Markdown safely" | Implemented |
| T7 | Images hot-linked from elsewhere, or without alternative text | Images only from `asset:` through the host's asset port; no alt text refused on save | markdown "refuses an image without alt text" | Implemented |
| T8 | An unmoderated submission appears in public | Submissions are `in-review` with `moderation: pending`; only `moderate` releases them; `publish` cannot | lifecycle "moderation" | Implemented |
| T9 | A person's words published without consent, or kept after erasure | Consent field required to publish; erasure deletes every version, link, redirect and approval; superseded versions deleted after retention; readers never get the subject or consent field | `tests/personal-data.test.ts` | Implemented |
| T10 | A lost update overwrites another editor's work | Every action carries `expectedVersion`; anything else is `version-stale` | lifecycle "versions" | Implemented |
| T11 | A broken or hijacked address after a rename; an open redirect | Redirects recorded automatically, pointing at a document id, never at a URL; only site paths are ever redirect targets | `tests/addresses.test.ts` | Implemented |
| T12 | Unpublishing silently breaks pages that link to a document | Links stored by id; unpublishing or archiving needs `acknowledgedLinks` at least the current count | addresses "lists every document linking" | Implemented |
| T13 | Content, titles or names leak through events or logs | Events carry identifiers, codes, counts and times only (strict schemas); errors carry codes, never values | `tests/events.test.ts`; contracts "carries identifiers" | Implemented |
| T14 | A change without its event, or an event without its change | Outbox written in the same transaction; relayed at least once, in order | events "same transaction" | Implemented |
| T15 | Cross-site request forgery on administration | State-changing requests need an Origin on the request's own host; administration pages never framed, cached or sent as a Referer | http "refuses state-changing requests"; e2e "protects the administration pages" | Implemented |
| T16 | The subject or the author spoofed in a request body | Subject only from the host's resolver; bodies parsed strictly, so an extra `subject` is refused | http "takes the subject only from the host's resolver" | Implemented |
| T17 | The runtime role alters the schema or bypasses row security | Migrations run as the owner; the runtime role gets data access to its tables only, no ownership, no BYPASSRLS; migrations serialised by an advisory lock | `tests/migrations.test.ts` | Implemented |
| T18 | A missing or failing port leads to an implicit store, a default type or a partial answer | Required ports fail closed (`PublisherCompositionError`, `unavailable`); no in-memory store; no built-in type; stored documents of an unregistered type stop the layer at start-up | composition tests | Implemented |
| T19 | Injection through SQL, feed XML or headers | Parameterised SQL only; every row parsed with the contract's schemas before it leaves the layer; feed text escaped; origins parsed | reading "escaping every title"; contracts | Implemented |
| T20 | An import bypasses the checks a save makes | Imports check every version against its type, all or nothing, and only into documents that do not exist | `tests/bundle.test.ts` | Implemented |

## 4. Gaps and risk treatments

- **Denial of service by large content.** Strings, arrays and Markdown fields are bounded by the declaration (100,000 characters at most per Markdown field), and listings by 100 per request. Rate limiting is the host's.
- **Malicious assets.** The publisher trusts the address the asset port answers; scanning uploads is the host's asset store's duty.
- **Approval port integrity.** The approval port is trusted to answer for the digest asked; the publisher checks the digest and the approvers' count, not who they are.
