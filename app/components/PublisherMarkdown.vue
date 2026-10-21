<script lang="ts">
import type { PropType } from 'vue'
import { defineComponent, h } from 'vue'
import type { PublisherResolvedLinks } from '../../shared/contracts'
import { parsePublisherMarkdown } from '../../markdown/dialect'
import { publisherClasses } from '../utils/publisher-classes'
import { renderPublisherMarkdown } from '../utils/publisher-markdown-render'

/**
 * PUBLIC. Renders Markdown in the shared dialect safely anywhere: parsed to
 * the dialect's own tree and drawn as VNodes, never as HTML. `links` gives
 * the addresses of `doc:` links and `asset:` images; without it they render
 * as text and nothing.
 */
export default defineComponent({
  name: 'PublisherMarkdown',
  props: {
    source: { type: String, required: true },
    links: { type: Object as PropType<PublisherResolvedLinks>, default: () => ({ documents: {}, assets: {} }) },
  },
  setup(props) {
    return () => h('div', { class: publisherClasses.article }, renderPublisherMarkdown(parsePublisherMarkdown(props.source), props.links))
  },
})
</script>
