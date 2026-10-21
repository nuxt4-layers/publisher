<script setup lang="ts">
import type { PublisherContentInput } from '../../shared/contracts'
import type { PublisherTypeView } from '../composables/usePublisher'

/** The envelope's content and the type's own fields, as one form. It decides nothing. */
const props = defineProps<{ type: PublisherTypeView, idPrefix: string }>()
const content = defineModel<PublisherContentInput>({ required: true })
const text = usePublisherText()

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
      <label :for="`${idPrefix}-title`" :class="publisherClasses.label">{{ text('publisher.admin.title') }}</label>
      <input :id="`${idPrefix}-title`" :value="content.title" type="text" required :class="publisherClasses.input" @input="set('title', ($event.target as HTMLInputElement).value)">
    </div>
    <div>
      <label :for="`${idPrefix}-summary`" :class="publisherClasses.label">{{ text('publisher.admin.summary') }}</label>
      <textarea :id="`${idPrefix}-summary`" :value="content.summary ?? ''" rows="2" :class="publisherClasses.input" @input="set('summary', nullable(($event.target as HTMLTextAreaElement).value))" />
    </div>
    <div v-if="type.address.kind === 'path'">
      <label :for="`${idPrefix}-slug`" :class="publisherClasses.label">{{ text('publisher.admin.slug') }}</label>
      <input :id="`${idPrefix}-slug`" :value="content.slug ?? ''" type="text" :class="publisherClasses.input" :aria-describedby="`${idPrefix}-slug-hint`" @input="set('slug', ($event.target as HTMLInputElement).value)">
      <p :id="`${idPrefix}-slug-hint`" :class="publisherClasses.hint">{{ text('publisher.admin.slug-hint') }}</p>
    </div>
    <div v-if="type.address.kind === 'path' && type.address.pattern === 'date-slug'">
      <label :for="`${idPrefix}-date`" :class="publisherClasses.label">{{ text('publisher.admin.address-date') }}</label>
      <input :id="`${idPrefix}-date`" :value="content.addressDate ?? ''" type="text" inputmode="numeric" :class="publisherClasses.input" :aria-describedby="`${idPrefix}-date-hint`" @input="set('addressDate', nullable(($event.target as HTMLInputElement).value))">
      <p :id="`${idPrefix}-date-hint`" :class="publisherClasses.hint">{{ text('publisher.admin.address-date-hint') }}</p>
    </div>
    <div>
      <label :for="`${idPrefix}-locale`" :class="publisherClasses.label">{{ text('publisher.admin.locale') }}</label>
      <input :id="`${idPrefix}-locale`" :value="content.locale" type="text" required :class="publisherClasses.input" @input="set('locale', ($event.target as HTMLInputElement).value)">
    </div>
    <fieldset :class="publisherClasses.fieldset">
      <legend :class="publisherClasses.legend">{{ text('publisher.admin.fields') }}</legend>
      <PublisherField
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
