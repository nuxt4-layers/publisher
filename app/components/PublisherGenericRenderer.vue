<script setup lang="ts">
import type { PublisherRendered } from '../../shared/contracts'

/** PUBLIC. The renderer for types the host registers none for: the title, the summary, then each Markdown field in order. */
defineProps<{ rendered: PublisherRendered }>()
</script>

<template>
  <article :class="publisherClasses.stack">
    <h1 :class="publisherClasses.title">{{ rendered.document.title }}</h1>
    <p v-if="rendered.document.summary" :class="publisherClasses.text">{{ rendered.document.summary }}</p>
    <PublisherMarkdown v-for="(source, index) in rendered.markdown" :key="index" :source="source" :links="rendered.links" />
  </article>
</template>
