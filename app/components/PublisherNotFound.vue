<script setup lang="ts">
/** PUBLIC. What a reader sees where nothing is published: missing, draft or erased alike. */
const text = usePublisherText()
</script>

<template>
  <div :class="publisherClasses.stack">
    <h1 :class="publisherClasses.title">{{ text('publisher.reader.not-found-title') }}</h1>
    <p :class="publisherClasses.text">{{ text('publisher.reader.not-found') }}</p>
    <p><NuxtLink to="/" :class="publisherClasses.actionLink">{{ text('publisher.reader.home') }}</NuxtLink></p>
  </div>
</template>
