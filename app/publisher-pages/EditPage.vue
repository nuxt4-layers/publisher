<script setup lang="ts">
import type { PublisherAction, PublisherActionRequestInput, PublisherContentInput, PublisherDocument } from '../../shared/contracts'

/**
 * One document: its content in the type's own form, the actions its status
 * allows, its history and the documents that link to it. Every action is
 * decided again on the server.
 */
const text = usePublisherText()
const routes = usePublisherRoutes()
const publisher = usePublisher()
const action = usePublisherAction()
const route = useRoute()
const editor = usePublisherComponents().editor()
const documentId = String(route.params.documentId ?? '')

const { data: types } = await useAsyncData('publisher:admin:types', () => publisher.types().catch(() => []))
const { data: document, error, refresh } = await useAsyncData(`publisher:admin:document:${documentId}`, () => publisher.document(documentId))
const { data: history, refresh: refreshHistory } = await useAsyncData(`publisher:admin:history:${documentId}`, () => document.value ? publisher.history(documentId) : Promise.resolve([]))
const { data: backlinks, refresh: refreshBacklinks } = await useAsyncData(`publisher:admin:backlinks:${documentId}`, () => document.value ? publisher.backlinks(documentId) : Promise.resolve([]))
const access = computed(() => error.value ? (publisherErrorOf(error.value)?.code ?? 'unavailable') : null)
const type = computed(() => types.value?.find(candidate => candidate.type === document.value?.type) ?? null)
useHead(() => ({ title: document.value?.title ?? text('publisher.admin.documents-title'), htmlAttrs: { lang: text('publisher.language') } }))

function contentOf(source: PublisherDocument): PublisherContentInput {
  return { locale: source.locale, title: source.title, summary: source.summary, fields: structuredClone(toRaw(source.fields)), slug: source.slug, addressDate: source.addressDate, authors: [...source.authors] }
}
const content = ref<PublisherContentInput>(document.value ? contentOf(document.value) : { locale: 'en-GB', title: '', fields: {} })
const formKey = ref(0)
watch(document, (next) => {
  if (next) {
    content.value = contentOf(next)
    formKey.value++
  }
})

const done = ref<string | null>(null)
const confirming = ref<'unpublish' | 'archive' | null>(null)
const publishAt = ref('')
const unpublishAt = ref('')
const status = computed(() => document.value?.status)
const may = computed(() => type.value?.may ?? { 'view-draft': false, 'edit': false, 'publish': false, 'moderate': false })
const newer = computed(() => document.value !== null && document.value !== undefined && document.value.latestVersion !== document.value.publishedVersion)
const offered = computed(() => {
  const actions: PublisherAction[] = []
  const current = status.value
  if (!current || !type.value) return actions
  const pending = document.value?.moderation === 'pending'
  if (editor && may.value.edit && current !== 'archived') actions.push('save')
  if (may.value.edit && type.value.lifecycle.approval && (current === 'draft' || (current === 'published' && newer.value && document.value?.reviewVersion !== document.value?.latestVersion))) actions.push('submit')
  if (may.value.edit && (current === 'in-review' || current === 'scheduled') && !pending) actions.push('withdraw')
  if (may.value.publish && !pending && (current === 'draft' || current === 'in-review' || (current === 'published' && newer.value))) actions.push('publish')
  if (may.value.publish && current === 'published') actions.push('unpublish')
  if (may.value.publish && current !== 'archived') actions.push('archive')
  if (may.value.edit && current === 'archived') actions.push('reopen')
  return actions
})
const documentPath = (id: string) => routes.document.replace(':documentId', id)

async function perform(request: PublisherActionRequestInput, message: string) {
  done.value = null
  const result = await action.run(() => publisher.act(documentId, request))
  if (result) {
    confirming.value = null
    await Promise.all([refresh(), refreshHistory(), refreshBacklinks()])
    done.value = message
  }
}

async function run(name: PublisherAction) {
  const current = document.value
  if (!current) return
  const expectedVersion = current.latestVersion
  if (name === 'save') return perform({ action: 'save', expectedVersion, content: content.value }, text('publisher.done.save'))
  if (name === 'publish') {
    const at = publishAt.value ? new Date(publishAt.value).toISOString() : null
    const until = unpublishAt.value ? new Date(unpublishAt.value).toISOString() : null
    return perform({ action: 'publish', expectedVersion, publishAt: at, unpublishAt: until }, text(at && new Date(at) > new Date() ? 'publisher.done.scheduled' : 'publisher.done.publish'))
  }
  if (name === 'unpublish' || name === 'archive') {
    if ((backlinks.value?.length ?? 0) > 0 && confirming.value !== name) {
      confirming.value = name
      return
    }
    return perform({ action: name, expectedVersion, acknowledgedLinks: backlinks.value?.length ?? 0 }, text(`publisher.done.${name}`))
  }
  if (name === 'submit' || name === 'withdraw' || name === 'reopen') return perform({ action: name, expectedVersion }, text(`publisher.done.${name}`))
}

async function restore(version: number) {
  if (!document.value) return
  await perform({ action: 'restore', expectedVersion: document.value.latestVersion, version }, text('publisher.done.restore'))
}
const previewPath = computed(() => document.value?.path ? `${document.value.path}?preview=1` : null)
const formatTime = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16)
</script>

<template>
  <main :class="publisherClasses.screen">
    <div :class="publisherClasses.card">
      <template v-if="access || !document">
        <h1 :class="publisherClasses.title">{{ text('publisher.admin.documents-title') }}</h1>
        <PublisherAlert v-if="access === 'unauthenticated'" tone="error">
          {{ text('publisher.admin.sign-in') }}
          <NuxtLink :to="routes.signIn" :class="publisherClasses.link">{{ text('publisher.admin.sign-in-link') }}</NuxtLink>
        </PublisherAlert>
        <PublisherAlert v-else tone="error">{{ text('publisher.admin.forbidden') }}</PublisherAlert>
      </template>
      <div v-else :class="publisherClasses.stack">
        <p><NuxtLink :to="`${routes.documents}?type=${document.type}`" :class="publisherClasses.actionLink">{{ text('publisher.admin.back') }}</NuxtLink></p>
        <h1 :class="publisherClasses.title">{{ document.title }}</h1>
        <div :class="publisherClasses.row">
          <span :class="publisherClasses.badge">{{ text(`publisher.status.${document.status}`) }}</span>
          <span :class="publisherClasses.muted">{{ text('publisher.admin.version', { version: document.latestVersion }) }}</span>
          <span v-if="document.publishedVersion" :class="publisherClasses.muted">{{ text('publisher.admin.published-version', { version: document.publishedVersion }) }}</span>
          <span v-if="document.publishAt" :class="publisherClasses.muted">{{ text('publisher.admin.scheduled-for', { at: formatTime(document.publishAt) }) }}</span>
          <span v-if="type" :class="publisherClasses.muted">{{ text(`publisher.risk.${type.risks.publish}`) }}</span>
          <NuxtLink v-if="previewPath" :to="previewPath" :class="publisherClasses.actionLink">{{ text('publisher.admin.preview') }}</NuxtLink>
        </div>
        <PublisherAlert v-if="document.moderation === 'pending'" tone="warning">{{ text('publisher.admin.moderation-pending') }}</PublisherAlert>
        <PublisherAlert v-if="done" tone="success">{{ done }}</PublisherAlert>
        <PublisherAlert v-if="action.error.value" tone="error">{{ action.error.value }}</PublisherAlert>

        <PublisherAlert v-if="!editor" tone="info">{{ text('publisher.admin.read-only') }}</PublisherAlert>
        <form v-if="type" :class="publisherClasses.stack" @submit.prevent="run('save')">
          <component :is="editor" v-if="editor && offered.includes('save')" :id="`publisher-edit-${document.id}`" :key="formKey" v-model="content" :type="type" />
          <div v-if="type.lifecycle.scheduling && offered.includes('publish')" :class="publisherClasses.row">
            <div>
              <label for="publisher-publish-at" :class="publisherClasses.label">{{ text('publisher.admin.publish-at') }}</label>
              <input id="publisher-publish-at" v-model="publishAt" type="datetime-local" :class="publisherClasses.input" aria-describedby="publisher-schedule-hint">
            </div>
            <div>
              <label for="publisher-unpublish-at" :class="publisherClasses.label">{{ text('publisher.admin.unpublish-at') }}</label>
              <input id="publisher-unpublish-at" v-model="unpublishAt" type="datetime-local" :class="publisherClasses.input" aria-describedby="publisher-schedule-hint">
            </div>
            <p id="publisher-schedule-hint" :class="publisherClasses.hint">{{ text('publisher.admin.schedule-hint') }}</p>
          </div>
          <div :class="publisherClasses.row" role="group" :aria-label="text('publisher.admin.actions')">
            <button
              v-for="name in offered"
              :key="name"
              :type="name === 'save' ? 'submit' : 'button'"
              :class="name === 'save' || name === 'publish' ? publisherClasses.primaryButton : name === 'unpublish' || name === 'archive' ? publisherClasses.dangerButton : publisherClasses.secondaryButton"
              :disabled="action.disabled.value"
              @click="name === 'save' ? undefined : run(name)"
            >
              {{ text(`publisher.action.${name}`) }}
            </button>
          </div>
        </form>

        <div v-if="confirming" role="alertdialog" aria-labelledby="publisher-confirm-title" aria-modal="false" :class="[publisherClasses.alertWarning, publisherClasses.stack]">
          <p id="publisher-confirm-title">{{ text('publisher.admin.linked-warning', { count: backlinks?.length ?? 0 }) }}</p>
          <div :class="publisherClasses.row">
            <button type="button" :class="publisherClasses.dangerButton" :disabled="action.disabled.value" @click="run(confirming)">{{ text(confirming === 'unpublish' ? 'publisher.admin.unpublish-anyway' : 'publisher.admin.archive-anyway') }}</button>
            <button type="button" :class="publisherClasses.secondaryButton" @click="confirming = null">{{ text('publisher.action.cancel') }}</button>
          </div>
        </div>

        <section :class="publisherClasses.section" aria-labelledby="publisher-backlinks">
          <h2 id="publisher-backlinks" :class="publisherClasses.sectionTitle">{{ text('publisher.admin.backlinks') }}</h2>
          <ul v-if="backlinks?.length" :class="publisherClasses.list">
            <li v-for="link in backlinks" :key="link.documentId" :class="publisherClasses.listItem">
              <NuxtLink v-if="link.title !== null" :to="documentPath(link.documentId)" :class="publisherClasses.actionLink">{{ link.title }}</NuxtLink>
              <span v-else :class="publisherClasses.muted">{{ text('publisher.admin.hidden-backlink') }}</span>
              <span :class="publisherClasses.badge">{{ text(`publisher.status.${link.status}`) }}</span>
            </li>
          </ul>
          <p v-else :class="publisherClasses.muted">{{ text('publisher.admin.no-backlinks') }}</p>
        </section>

        <section :class="publisherClasses.section" aria-labelledby="publisher-history">
          <h2 id="publisher-history" :class="publisherClasses.sectionTitle">{{ text('publisher.admin.history') }}</h2>
          <ul :class="publisherClasses.list">
            <li v-for="version in history ?? []" :key="version.version" :class="publisherClasses.listItem">
              <span :class="publisherClasses.text">
                {{ text('publisher.admin.version', { version: version.version }) }}
                <span :class="publisherClasses.muted">{{ text('publisher.admin.saved', { at: formatTime(version.savedAt) }) }}</span>
                <span v-if="version.restoredFrom" :class="publisherClasses.muted">{{ text('publisher.admin.restored-from', { version: version.restoredFrom }) }}</span>
              </span>
              <button
                v-if="version.version !== document.latestVersion && may.edit && document.status !== 'archived'"
                type="button"
                :class="publisherClasses.secondaryButton"
                :disabled="action.disabled.value"
                @click="restore(version.version)"
              >
                {{ text('publisher.action.restore', { version: version.version }) }}
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </main>
</template>
