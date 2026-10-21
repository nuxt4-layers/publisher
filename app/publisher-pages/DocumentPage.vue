<script setup lang="ts">
/**
 * The catch-all route (`publisher-document`): whatever is published at this
 * address, a redirect, or the designed not-found answer with status 404. A
 * draft without `view-draft` answers exactly as a missing document.
 */
const route = useRoute()
const text = usePublisherText()
const publisher = usePublisher()
const preview = route.query.preview === '1'
const { data } = await useAsyncData(`publisher:resolve:${route.path}:${preview}`, () => publisher.resolve(route.path, preview))
const resolution = computed(() => data.value ?? { kind: 'none' as const })

if (resolution.value.kind === 'redirect') await navigateTo(resolution.value.to, { redirectCode: 301, replace: true })
if (resolution.value.kind !== 'document' && import.meta.server) setResponseStatus(useRequestEvent()!, 404)

const rendered = computed(() => resolution.value.kind === 'document' ? resolution.value.rendered : null)
const origin = useRequestURL().origin
useHead(() => rendered.value
  ? {
      title: rendered.value.head.title,
      titleTemplate: null,
      htmlAttrs: { lang: rendered.value.head.locale },
      link: rendered.value.head.canonicalPath ? [{ rel: 'canonical', href: `${origin}${rendered.value.head.canonicalPath}` }] : [],
      meta: [
        ...(rendered.value.head.description ? [{ name: 'description', content: rendered.value.head.description }, { property: 'og:description', content: rendered.value.head.description }] : []),
        { property: 'og:title', content: rendered.value.document.title },
        { property: 'og:type', content: 'article' },
        ...(rendered.value.head.canonicalPath ? [{ property: 'og:url', content: `${origin}${rendered.value.head.canonicalPath}` }] : []),
        ...(rendered.value.head.publishedAt ? [{ property: 'article:published_time', content: rendered.value.head.publishedAt }] : []),
        { property: 'article:modified_time', content: rendered.value.head.modifiedAt },
        ...(rendered.value.preview ? [{ name: 'robots', content: 'noindex' }] : []),
      ],
    }
  : { title: text('publisher.reader.not-found-title'), htmlAttrs: { lang: text('publisher.language') }, meta: [{ name: 'robots', content: 'noindex' }] })
</script>

<template>
  <main :class="publisherClasses.screen">
    <div :class="publisherClasses.card">
      <template v-if="rendered">
        <PublisherAlert v-if="rendered.preview" tone="info">{{ text('publisher.reader.preview') }}</PublisherAlert>
        <PublisherDocument :rendered="rendered" />
      </template>
      <PublisherNotFound v-else />
    </div>
  </main>
</template>
