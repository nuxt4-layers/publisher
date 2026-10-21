<script setup lang="ts">
import type { PublisherRendered } from '../../shared/contracts'

/**
 * PUBLIC. Draws a rendered document through the renderer the host
 * registered for its type, or the generic one, and names its authors only
 * through the host's person-name component.
 */
const props = defineProps<{ rendered: PublisherRendered }>()
const text = usePublisherText()
const components = usePublisherComponents()
const renderer = computed(() => components.renderer(props.rendered.document.type))
const personName = computed(() => components.personName())
</script>

<template>
  <div :class="publisherClasses.stack">
    <component :is="renderer" v-if="renderer" :rendered="rendered" />
    <PublisherGenericRenderer v-else :rendered="rendered" />
    <p v-if="personName && rendered.document.authors.length" :class="publisherClasses.muted">
      {{ text('publisher.reader.by') }}
      <template v-for="(author, index) in rendered.document.authors" :key="author">
        <component :is="personName" :identity-id="author" /><template v-if="index < rendered.document.authors.length - 1">{{ ', ' }}</template>
      </template>
    </p>
  </div>
</template>
