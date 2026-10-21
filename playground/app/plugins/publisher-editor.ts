import PlaygroundEditor from '../components/PlaygroundEditor.vue'

/**
 * Composes the stand-in for content-editor through the publisher's editor
 * slot, as a host composes the real one. The browser tests turn it off with
 * the `publisher_playground_editor=none` cookie, to see the screens without
 * an editor.
 */
export default defineNuxtPlugin(() => {
  if (useCookie('publisher_playground_editor').value === 'none') return
  providePublisherEditor(PlaygroundEditor)
})
