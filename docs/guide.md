# Using the Publisher

> **In short:** register your document types, fill the publisher's ports from the IAM members and your host, then call its services. The publisher stores, versions, approves, publishes and serves documents. How they look is up to you.

This guide describes the publisher once it is headless ([ADR-0009](https://github.com/nuxt4-layers/platform-architecture/blob/667e5310a66c56327f0ef80d43ce01b573ce6d86/docs/decisions/ADR-0009-headless-capability-layers.md), [ADR-0011](https://github.com/nuxt4-layers/platform-architecture/blob/667e5310a66c56327f0ef80d43ce01b573ce6d86/docs/decisions/ADR-0011-shared-rich-text-and-configurable-copy.md); [migration plan](headless-migration.md)). The [contract](contracts.md) is the full reference.

## What it gives you

| Service | For |
|---|---|
| **Server functions** | Every task: create, save, submit, publish, schedule, archive, restore, moderate, read, list, export |
| **HTTP API** (`/api/publisher/*`) | The same tasks for browsers and other services; switch it off with `NUXT_PUBLISHER_API_ENABLED=false` |
| **A typed client** (`usePublisher()`) | Calling the HTTP API from your own screens: data and actions only |
| **Safe content** | Rich text returned as `rich-text`'s safe tree, which your components draw; never as HTML |
| **Feeds and sitemap entries** | RSS, Atom, and paths for your `sitemap.xml` |
| **Events** | What happened, for search indexes, caches or notifications |

It draws nothing: no pages, routes, components or styles.

## What it needs from you

| Port | Required | Usually filled from | Gives the publisher |
|---|---|---|---|
| **Database** | Yes | Your host | PostgreSQL, under its own schema |
| **Document types** | Yes | Your host | What each kind of document is (see below) |
| **Subject resolver** | For the API | **Authentication** | Who is signed in, and how strongly |
| **Site resolver** | For the API | **Configuration** (tenant by host name) | Which site a request is for |
| **Access decision** | Yes | **Authorisation** | Whether someone may view drafts, edit, publish or moderate |
| **Approval** | For types needing approval | **iam-integration**'s approvals process | Consent to publish a version |
| **Event sink** | For the relay | Your host's event bus | Where events go |
| **Asset resolver** | No: images are refused | Your asset store | Each image's address |
| **Title template** | No: titles stand alone | **Configuration** (`seo.title-template`) | Page and feed titles |
| **Clock** | No: the system clock | Your host | The time |

People's names are not the publisher's: documents hold identity ids, and your screens ask **Profile** for names.

## 1. Compose it

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@nuxt4-layers/publisher'],
})
```

```ts
// server/plugins/publisher.ts: fill the ports at start-up
import pg from 'pg'
import { pagesType, postsType } from '../content-types'

export default defineNitroPlugin(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  providePublisherDatabase({ dialect: 'postgres', pool })
  providePublisherDocumentTypes([pagesType, postsType])

  // IAM, through each member's own server functions
  providePublisherSubjectResolver({ resolve: event => authenticatedPrincipal(event) })
  providePublisherAccessDecision({ allows: input => authorisation.allows(input) })
  providePublisherApproval({
    request: input => approvals.request(input),
    decision: input => approvals.decision(input),
  })

  // Configuration: the tenant this host name belongs to is the site
  providePublisherSiteResolver({ resolve: event => configuration.tenantForHost(event) })
  providePublisherTitleTemplate({ format: input => configuration.title(input) })

  providePublisherEventSink({ publish: events => bus.publish(events) })
  providePublisherAssetResolver({ resolve: input => assets.addresses(input) })

  await migratePublisherDatabase()
  await checkPublisherComposition() // fails at start-up if anything is missing
})
```

The member functions above stand for the adapters your host writes; each port's exact shape is in [the contract](contracts.md) §11.

## 2. Declare document types

A type is data, not code in the layer. Copy from [`./examples`](../examples/index.ts) or write your own.

```ts
import { z } from 'zod'
import { definePublisherDocumentType } from '@nuxt4-layers/publisher/contracts'
import { richTextSchema } from '@nuxt4-layers/rich-text'

export const postsType = definePublisherDocumentType({
  type: 'post',
  label: { one: 'Post', many: 'Posts' },
  // The body is formatted: a full document, checked on every save against that profile.
  // Tags are plain strings, edited with standard form controls.
  fields: z.strictObject({ body: richTextSchema({ profile: 'document', max: 50_000 }), tags: z.array(z.string().max(40)).max(10) }),
  address: { kind: 'path', base: '/blog', pattern: 'date-slug' },
  listing: { listable: true, order: 'published-desc', filterable: ['tags'] },
  lifecycle: { approval: false, moderation: false, scheduling: true },
})
```

Title and slug are always plain. Draw a formatted field's input with `content-editor` where it helps; a plain `<textarea>` works too, because the publisher checks every save.

Then give **Authorisation** the permissions the types create:

```ts
const permissions = publisherPermissions(usePublisherRegistry())
// e.g. publisher.post.view-draft (low), publisher.post.edit (low), publisher.post.publish (medium) …
```

## 3. Write

Every call names the site and the signed-in person, and checks their permission.

```ts
const draft = await createPublisherDocument({
  siteId, subject, correlationId,
  type: 'post',
  content: { locale: 'en-GB', title: 'Hello', slug: 'hello', fields: { body: 'First **post**.', tags: [] } },
})

await transitionPublisherDocument({
  siteId, subject, correlationId,
  documentId: draft.id,
  request: { action: 'publish', expectedVersion: draft.latestVersion },
})
```

| Action | Does |
|---|---|
| `save`, `restore` | A new version |
| `submit`, `withdraw` | Ask for approval, or take it back |
| `publish` | Now, or at `publishAt`; optionally until `unpublishAt` |
| `unpublish`, `archive`, `reopen` | Take it down, retire it, bring it back as a draft |
| `moderate` | Accept or reject a submission |

From a browser, the same through the client:

```ts
const publisher = usePublisher()
await publisher.act(documentId, { action: 'publish', expectedVersion })
```

## 4. Read and show

Your host owns the route. Ask the publisher what an address holds, and draw it with your own components.

```vue
<!-- pages/[...path].vue in your host -->
<script setup lang="ts">
const route = useRoute()
const { data } = await useAsyncData(() => usePublisher().resolve(route.path, false))
if (data.value?.kind === 'redirect') await navigateTo(data.value.to, { redirectCode: 301 })
</script>

<template>
  <main>
    <article v-if="data?.kind === 'document'">
      <h1>{{ data.rendered.document.title }}</h1>
      <!-- Each rich-text field arrives as a safe tree: draw it with ui's renderer -->
      <UiRichText v-for="field in data.rendered.richText" :key="field.path" :nodes="field.nodes" :links="data.rendered.links" />
    </article>
    <NotFound v-else />
  </main>
</template>
```

| To show | Call |
|---|---|
| One document | `resolvePublisherPath`, or `getPublishedDocument` by id |
| A list | `listPublishedDocuments` (filters, order, paging) |
| A feed | `getPublisherFeed` (RSS or Atom) |
| Sitemap entries | `listPublisherSitemapEntries` |
| A draft preview | Any of the above with `preview: true`; needs `view-draft` |

A draft, or anything the viewer may not see, answers exactly like a missing document.

## 5. Run the background tasks

```ts
// Every minute: publish and archive on schedule, apply retention
await runPublisherMaintenance()
// Often: send new events to your bus
await relayPublisherOutbox()
```

## 6. Personal data

For types that hold a person's words, **iam-integration**'s data-subject requests call:

```ts
await exportPublisherPersonData({ identityId })
await erasePublisherPerson({ identityId, correlationId })
```

Both cover every site and every version.
