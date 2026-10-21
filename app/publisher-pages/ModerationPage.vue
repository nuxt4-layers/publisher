<script setup lang="ts">
import type { PublisherDocument } from '../../shared/contracts'

/** Submissions awaiting a moderator, of the types the signed-in person may moderate. */
const text = usePublisherText()
const routes = usePublisherRoutes()
const publisher = usePublisher()
const action = usePublisherAction()
useHead({ title: text('publisher.admin.moderation-title') , htmlAttrs: { lang: text('publisher.language') } })

const { data: types } = await useAsyncData('publisher:admin:types', () => publisher.types().catch(() => []))
const { data: queue, error, refresh } = await useAsyncData('publisher:admin:moderation', () => publisher.moderation())
const access = computed(() => error.value ? (publisherErrorOf(error.value)?.code ?? 'unavailable') : null)
const done = ref<string | null>(null)
const formattedOf = (document: PublisherDocument) => {
  const fields = types.value?.find(type => type.type === document.type)?.richTextFields ?? []
  return fields.filter(field => !field.path.includes('.') && !field.path.includes('[]'))
    .flatMap(field => typeof document.fields[field.path] === 'string' ? [{ source: document.fields[field.path] as string, profile: field.profile }] : [])
}
async function moderate(document: PublisherDocument, outcome: 'accept' | 'reject') {
  done.value = null
  const result = await action.run(() => publisher.act(document.id, { action: 'moderate', expectedVersion: document.latestVersion, outcome }))
  if (result) {
    done.value = text(`publisher.done.${outcome}`)
    await refresh()
  }
}
</script>

<template>
  <main :class="publisherClasses.screen">
    <div :class="publisherClasses.card">
      <h1 :class="publisherClasses.title">{{ text('publisher.admin.moderation-title') }}</h1>
      <PublisherAlert v-if="access === 'unauthenticated'" tone="error">
        {{ text('publisher.admin.sign-in') }}
        <NuxtLink :to="routes.signIn" :class="publisherClasses.link">{{ text('publisher.admin.sign-in-link') }}</NuxtLink>
      </PublisherAlert>
      <PublisherAlert v-else-if="access" tone="error">{{ text(`publisher.error.${access}`) }}</PublisherAlert>
      <div v-else :class="publisherClasses.stack">
        <PublisherAlert v-if="done" tone="success">{{ done }}</PublisherAlert>
        <PublisherAlert v-if="action.error.value" tone="error">{{ action.error.value }}</PublisherAlert>
        <article v-for="document in queue?.documents ?? []" :key="document.id" :aria-labelledby="`publisher-submission-${document.id}`" :class="[publisherClasses.section, publisherClasses.stack]">
          <h2 :id="`publisher-submission-${document.id}`" :class="publisherClasses.sectionTitle">{{ document.title }}</h2>
          <PublisherMarkdown v-for="(field, index) in formattedOf(document)" :key="index" :source="field.source" :profile="field.profile" />
          <div :class="publisherClasses.row">
            <button type="button" :class="publisherClasses.primaryButton" :disabled="action.disabled.value" @click="moderate(document, 'accept')">{{ text('publisher.action.accept') }}</button>
            <button type="button" :class="publisherClasses.dangerButton" :disabled="action.disabled.value" @click="moderate(document, 'reject')">{{ text('publisher.action.reject') }}</button>
          </div>
        </article>
        <p v-if="!queue?.documents.length" :class="publisherClasses.muted">{{ text('publisher.admin.no-submissions') }}</p>
      </div>
    </div>
  </main>
</template>
