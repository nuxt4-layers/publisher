import type { Component } from 'vue'

/**
 * App-side registrations (docs/contracts.md §11): the renderer for each
 * type, the editor for Markdown fields and the person-name component. A
 * host registers them from a Nuxt plugin. Components are static, so they are
 * kept once for every request. Each is optional: without a renderer, the
 * generic one; without an editor, a plain Markdown text area; without a
 * person-name component, authors are not named.
 */
const renderers = new Map<string, Component>()
let editor: Component | null = null
let personName: Component | null = null

/** The component that draws documents of this type. It receives `rendered` (PublisherRendered) as a prop. */
export function providePublisherRenderer(type: string, component: Component): void {
  renderers.set(type, component)
}

/** The editing component for Markdown fields: `v-model` (string), `id` and `label` props. */
export function providePublisherEditor(component: Component): void {
  editor = component
}

/** The host's person-name component: an `identityId` prop. */
export function providePublisherPersonName(component: Component): void {
  personName = component
}

export function usePublisherComponents() {
  return { renderer: (type: string) => renderers.get(type) ?? null, editor: () => editor, personName: () => personName }
}
