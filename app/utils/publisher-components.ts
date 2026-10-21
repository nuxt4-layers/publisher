import type { Component } from 'vue'

/**
 * App-side registrations (docs/contracts.md §11): the renderer for each
 * type, the editor and the person-name component. A host registers them
 * from a Nuxt plugin; they are kept on the Nuxt app, so each request (and
 * the browser) has its own. Each is optional: without a renderer, the
 * generic one; without an editor, documents are not edited on the layer's
 * screens; without a person-name component, authors are not named.
 */
interface Registrations {
  renderers: Map<string, Component>
  editor: Component | null
  personName: Component | null
}

function registrations(): Registrations {
  const app = useNuxtApp() as unknown as { _publisherComponents?: Registrations }
  return (app._publisherComponents ??= { renderers: new Map(), editor: null, personName: null })
}

/** The component that draws documents of this type. It receives `rendered` (PublisherRendered) as a prop. */
export function providePublisherRenderer(type: string, component: Component): void {
  registrations().renderers.set(type, component)
}

/**
 * The editing surface for a version's content: `type` (PublisherEditorType)
 * and `id` props, and the content (PublisherContentInput) as `v-model`.
 */
export function providePublisherEditor(component: Component): void {
  registrations().editor = component
}

/** The host's person-name component: an `identityId` prop. */
export function providePublisherPersonName(component: Component): void {
  registrations().personName = component
}

export function usePublisherComponents() {
  const registered = registrations()
  return { renderer: (type: string) => registered.renderers.get(type) ?? null, editor: () => registered.editor, personName: () => registered.personName }
}
