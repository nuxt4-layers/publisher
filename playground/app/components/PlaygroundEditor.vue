<script setup lang="ts">
import type { PublisherContentInput, PublisherEditorType } from '../../../shared/contracts'

/**
 * PLAYGROUND ONLY: a stand-in for content-editor, composed through the
 * publisher's editor slot as a host would compose the real one. Not
 * published.
 */
const props = defineProps<{ type: PublisherEditorType, id: string }>()
const content = defineModel<PublisherContentInput>({ required: true })
const idPrefix = computed(() => props.id)

const properties = computed(() => ((props.type.schema as { properties?: Record<string, Record<string, unknown>> }).properties ?? {}))
const required = computed(() => ((props.type.schema as { required?: string[] }).required ?? []))
function set<Key extends keyof PublisherContentInput>(key: Key, value: PublisherContentInput[Key]) {
  content.value = { ...content.value, [key]: value }
}
function setField(name: string, value: unknown) {
  set('fields', { ...content.value.fields, [name]: value })
}
const nullable = (value: string) => value.trim() === '' ? null : value
</script>

<template>
  <div :class="publisherClasses.stack">
    <div>
      <label :for="`${idPrefix}-title`" :class="publisherClasses.label">Title</label>
      <input :id="`${idPrefix}-title`" :value="content.title" type="text" required :class="publisherClasses.input" @input="set('title', ($event.target as HTMLInputElement).value)">
    </div>
    <div>
      <label :for="`${idPrefix}-summary`" :class="publisherClasses.label">Summary</label>
      <textarea :id="`${idPrefix}-summary`" :value="content.summary ?? ''" rows="2" :class="publisherClasses.input" @input="set('summary', nullable(($event.target as HTMLTextAreaElement).value))" />
    </div>
    <div v-if="type.address.kind === 'path'">
      <label :for="`${idPrefix}-slug`" :class="publisherClasses.label">Slug</label>
      <input :id="`${idPrefix}-slug`" :value="content.slug ?? ''" type="text" :class="publisherClasses.input" :aria-describedby="`${idPrefix}-slug-hint`" @input="set('slug', ($event.target as HTMLInputElement).value)">
      <p :id="`${idPrefix}-slug-hint`" :class="publisherClasses.hint">The last part of the address, such as our-team.</p>
    </div>
    <div v-if="type.address.kind === 'path' && type.address.pattern === 'date-slug'">
      <label :for="`${idPrefix}-date`" :class="publisherClasses.label">Address date</label>
      <input :id="`${idPrefix}-date`" :value="content.addressDate ?? ''" type="text" inputmode="numeric" :class="publisherClasses.input" :aria-describedby="`${idPrefix}-date-hint`" @input="set('addressDate', nullable(($event.target as HTMLInputElement).value))">
      <p :id="`${idPrefix}-date-hint`" :class="publisherClasses.hint">YYYY-MM-DD. Left empty, the first publishing date.</p>
    </div>
    <div>
      <label :for="`${idPrefix}-locale`" :class="publisherClasses.label">Language</label>
      <input :id="`${idPrefix}-locale`" :value="content.locale" type="text" required :class="publisherClasses.input" @input="set('locale', ($event.target as HTMLInputElement).value)">
    </div>
    <fieldset :class="publisherClasses.fieldset">
      <legend :class="publisherClasses.legend">Content</legend>
      <PlaygroundField
        v-for="(schema, name) in properties"
        :id="`${idPrefix}-field-${name}`"
        :key="name"
        :schema="schema"
        :label="String(name)"
        :path="String(name)"
        :markdown-fields="type.markdownFields"
        :required="required.includes(String(name))"
        :model-value="content.fields[name]"
        @update:model-value="value => setField(String(name), value)"
      />
    </fieldset>
  </div>
</template>
