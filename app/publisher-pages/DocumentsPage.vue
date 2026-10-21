<script setup lang="ts">
import type { PublisherContentInput } from '../../shared/contracts'

/** Documents by type, with search, and a new document from the type's own form. */
const text = usePublisherText()
const routes = usePublisherRoutes()
const editor = usePublisherComponents().editor()
const publisher = usePublisher()
const action = usePublisherAction()
const route = useRoute()
useHead({ title: text('publisher.admin.documents-title') , htmlAttrs: { lang: text('publisher.language') } })

const { data: types, error: typesError } = await useAsyncData('publisher:admin:types', () => publisher.types())
const access = computed(() => typesError.value ? (publisherErrorOf(typesError.value)?.code ?? 'unavailable') : null)
const chosen = ref<string>(typeof route.query.type === 'string' ? route.query.type : '')
watchEffect(() => {
  if (!chosen.value && types.value?.length) chosen.value = types.value.find(type => type.may['view-draft'])?.type ?? types.value[0]!.type
})
const type = computed(() => types.value?.find(candidate => candidate.type === chosen.value) ?? null)
const search = ref('')
const { data: listing } = await useAsyncData(
  'publisher:admin:documents',
  () => type.value?.may['view-draft'] ? publisher.documents({ type: type.value.type, search: search.value }) : Promise.resolve(null),
  { watch: [chosen, search] },
)
const documentPath = (documentId: string) => routes.document.replace(':documentId', documentId)

const creating = ref(false)
const draft = ref<PublisherContentInput>({ locale: 'en-GB', title: '', fields: {} })
function startCreating() {
  draft.value = { locale: 'en-GB', title: '', slug: type.value?.address.kind === 'path' ? '' : null, fields: {} }
  creating.value = true
}
async function create() {
  if (!type.value) return
  const created = await action.run(() => publisher.create(type.value!.type, draft.value))
  if (created) await navigateTo(documentPath(created.id))
}
</script>

<template>
  <main :class="publisherClasses.screen">
    <div :class="publisherClasses.card">
      <h1 :class="publisherClasses.title">{{ text('publisher.admin.documents-title') }}</h1>
      <PublisherAlert v-if="access === 'unauthenticated'" tone="error">
        {{ text('publisher.admin.sign-in') }}
        <NuxtLink :to="routes.signIn" :class="publisherClasses.link">{{ text('publisher.admin.sign-in-link') }}</NuxtLink>
      </PublisherAlert>
      <PublisherAlert v-else-if="access" tone="error">{{ text(`publisher.error.${access}`) }}</PublisherAlert>
      <PublisherAlert v-else-if="!types?.length" tone="info">{{ text('publisher.admin.no-types') }}</PublisherAlert>
      <div v-else :class="publisherClasses.stack">
        <div :class="publisherClasses.row">
          <div>
            <label for="publisher-type" :class="publisherClasses.label">{{ text('publisher.admin.type') }}</label>
            <select id="publisher-type" v-model="chosen" :class="publisherClasses.select">
              <option v-for="candidate in types" :key="candidate.type" :value="candidate.type">{{ candidate.label.many }}</option>
            </select>
          </div>
          <div>
            <label for="publisher-search" :class="publisherClasses.label">{{ text('publisher.admin.search') }}</label>
            <input id="publisher-search" v-model="search" type="search" :class="publisherClasses.input">
          </div>
        </div>
        <div v-if="editor && type?.may.edit && !creating" :class="publisherClasses.row">
          <button type="button" :class="publisherClasses.primaryButton" :disabled="action.disabled.value" @click="startCreating">{{ text('publisher.admin.new', { label: type.label.one }) }}</button>
        </div>
        <form v-if="editor && type && creating" :class="publisherClasses.stack" @submit.prevent="create">
          <component :is="editor" :id="`publisher-new-${type.type}`" v-model="draft" :type="type" />
          <PublisherAlert v-if="action.error.value" tone="error">{{ action.error.value }}</PublisherAlert>
          <div :class="publisherClasses.row">
            <button type="submit" :class="publisherClasses.primaryButton" :disabled="action.disabled.value">{{ text('publisher.action.create') }}</button>
            <button type="button" :class="publisherClasses.secondaryButton" @click="creating = false">{{ text('publisher.action.cancel') }}</button>
          </div>
        </form>
        <p v-if="listing" :class="publisherClasses.muted">{{ text('publisher.admin.count', { count: listing.total }) }}</p>
        <ul v-if="listing?.documents.length" :class="publisherClasses.list">
          <li v-for="document in listing.documents" :key="document.id" :class="publisherClasses.listItem">
            <NuxtLink :to="documentPath(document.id)" :class="publisherClasses.actionLink">{{ document.title }}</NuxtLink>
            <span :class="publisherClasses.badge">{{ text(`publisher.status.${document.status}`) }}</span>
          </li>
        </ul>
        <p v-else-if="listing" :class="publisherClasses.muted">{{ text('publisher.admin.none') }}</p>
      </div>
    </div>
  </main>
</template>
