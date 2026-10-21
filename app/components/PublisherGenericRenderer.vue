<script setup lang="ts">
import type { PublisherRendered } from '../../shared/contracts'

/** PUBLIC. The renderer for types the host registers none for: the title, the summary, then each formatted field's safe tree in order. */
defineProps<{ rendered: PublisherRendered }>()
</script>

<template>
  <article :class="publisherClasses.stack">
    <h1 :class="publisherClasses.title">{{ rendered.document.title }}</h1>
    <p v-if="rendered.document.summary" :class="publisherClasses.text">{{ rendered.document.summary }}</p>
    <PublisherMarkdown v-for="entry in rendered.richText" :key="entry.path" :nodes="entry.nodes" :links="rendered.links" />
  </article>
</template>
