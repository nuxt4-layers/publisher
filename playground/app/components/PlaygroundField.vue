<script setup lang="ts">
/**
 * PLAYGROUND ONLY: one field of the stand-in editor, built from the type's
 * JSON Schema. Not published; a host composes content-editor instead.
 */
defineOptions({ name: 'PlaygroundField' })
const props = defineProps<{ schema: Record<string, unknown>, id: string, label: string, path: string, markdownFields: readonly string[], required?: boolean }>()
const model = defineModel<unknown>()

type Schema = Record<string, unknown> & { type?: string, enum?: string[], anyOf?: Schema[], properties?: Record<string, Schema>, required?: string[], items?: Schema, format?: string, default?: unknown }
const schema = computed(() => props.schema as Schema)
const markdown = computed(() => props.markdownFields.includes(props.path))
const kind = computed(() => {
  const s = schema.value
  if (markdown.value) return 'markdown'
  if (Array.isArray(s.enum)) return 'choice'
  if (s.type === 'string' || (Array.isArray(s.anyOf) && s.anyOf.every(option => option.type === 'string' || option.type === 'null'))) return 'text'
  if (s.type === 'number' || s.type === 'integer') return 'number'
  if (s.type === 'boolean') return 'switch'
  if (s.type === 'object' && s.properties) return 'group'
  if (s.type === 'array' && s.items?.type === 'string' && !s.items.enum) return 'lines'
  if (s.type === 'array' && s.items?.type === 'object' && s.items.properties) return 'list'
  return 'json'
})

const textValue = computed({
  get: () => typeof model.value === 'string' ? model.value : model.value === undefined || model.value === null ? '' : String(model.value),
  set: (value: string) => { model.value = value === '' && !props.required ? undefined : value },
})
const numberValue = computed({
  get: () => typeof model.value === 'number' ? String(model.value) : '',
  set: (value: string) => { model.value = value === '' ? undefined : Number(value) },
})
const switchValue = computed({
  get: () => model.value === true,
  set: (value: boolean) => { model.value = value },
})
const lines = computed({
  get: () => Array.isArray(model.value) ? (model.value as unknown[]).join('\n') : '',
  set: (value: string) => { model.value = value.split('\n').map(line => line.trim()).filter(Boolean) },
})
const json = ref(model.value === undefined ? '' : JSON.stringify(model.value, null, 2))
watch(json, (value) => {
  try {
    model.value = value.trim() === '' ? undefined : JSON.parse(value)
  }
  catch {
    // Left as it is: the server answers with the problem when it is sent.
  }
})

const group = computed(() => (model.value && typeof model.value === 'object' && !Array.isArray(model.value) ? model.value : {}) as Record<string, unknown>)
function setProperty(name: string, value: unknown) {
  model.value = { ...group.value, [name]: value }
}
const items = computed(() => (Array.isArray(model.value) ? model.value : []) as Record<string, unknown>[])
function setItem(index: number, value: unknown) {
  const next = [...items.value]
  next[index] = value as Record<string, unknown>
  model.value = next
}
function addItem() {
  model.value = [...items.value, {}]
}
function removeItem(index: number) {
  model.value = items.value.filter((_, at) => at !== index)
}
const hint = computed(() => kind.value === 'markdown' ? 'Markdown. Link documents with [text](doc:…), images with ![description](asset:…).' : kind.value === 'json' ? 'Edited as JSON.' : null)
</script>

<template>
  <fieldset v-if="kind === 'group'" :class="publisherClasses.fieldset">
    <legend :class="publisherClasses.legend">{{ label }}</legend>
    <PlaygroundField
      v-for="(child, name) in schema.properties"
      :id="`${id}-${name}`"
      :key="name"
      :schema="child"
      :label="String(name)"
      :path="`${path}.${name}`"
      :markdown-fields="markdownFields"
      :required="schema.required?.includes(String(name))"
      :model-value="group[name]"
      @update:model-value="value => setProperty(String(name), value)"
    />
  </fieldset>

  <fieldset v-else-if="kind === 'list'" :class="publisherClasses.fieldset">
    <legend :class="publisherClasses.legend">{{ label }}</legend>
    <div v-for="(item, index) in items" :key="index" :class="publisherClasses.stack">
      <PlaygroundField
        :id="`${id}-${index}`"
        :schema="schema.items!"
        :label="`${label} ${index + 1}`"
        :path="`${path}[]`"
        :markdown-fields="markdownFields"
        :model-value="item"
        @update:model-value="value => setItem(index, value)"
      />
      <div :class="publisherClasses.row">
        <button type="button" :class="publisherClasses.secondaryButton" @click="removeItem(index)">Remove</button>
      </div>
    </div>
    <div :class="publisherClasses.row">
      <button type="button" :class="publisherClasses.secondaryButton" @click="addItem">Add</button>
    </div>
  </fieldset>

  <div v-else-if="kind === 'switch'" :class="publisherClasses.row">
    <input :id="id" v-model="switchValue" type="checkbox" :class="publisherClasses.checkbox">
    <label :for="id" :class="publisherClasses.label">{{ label }}</label>
  </div>

  <div v-else>
    <label :for="id" :class="publisherClasses.label">{{ label }}</label>
    <select v-if="kind === 'choice'" :id="id" v-model="textValue" :class="publisherClasses.select" :required="required">
      <option value="" />
      <option v-for="option in schema.enum" :key="option" :value="option">{{ option }}</option>
    </select>
    <input v-else-if="kind === 'text'" :id="id" v-model="textValue" type="text" :class="publisherClasses.input" :required="required">
    <input v-else-if="kind === 'number'" :id="id" v-model="numberValue" type="number" :class="publisherClasses.input" :required="required">
    <textarea v-else-if="kind === 'lines'" :id="id" v-model="lines" rows="4" :class="publisherClasses.input" />
    <textarea v-else-if="kind === 'markdown'" :id="id" v-model="textValue" rows="8" :class="publisherClasses.textarea" :required="required" :aria-describedby="`${id}-hint`" />
    <textarea v-else :id="id" v-model="json" rows="6" :class="publisherClasses.textarea" :aria-describedby="`${id}-hint`" />
    <p v-if="hint" :id="`${id}-hint`" :class="publisherClasses.hint">{{ hint }}</p>
  </div>
</template>
