<script lang="ts">
import type { PropType } from 'vue'
import { defineComponent, h } from 'vue'
import { parseRichText, RICH_TEXT_PROFILES, type RichTextNode, type RichTextProfile } from '@nuxt4-layers/rich-text'
import type { PublisherResolvedLinks } from '../../shared/contracts'
import { publisherClasses } from '../utils/publisher-classes'
import { renderPublisherMarkdown } from '../utils/publisher-markdown-render'

/**
 * PUBLIC. Renders rich text safely anywhere: a safe tree (`nodes`, as answers
 * carry it), or a `source` parsed to one for its field's `profile`, drawn as
 * VNodes, never as HTML. `links` gives
 * the addresses of `doc:` links and `asset:` images; without it they render
 * as text and nothing.
 */
export default defineComponent({
  name: 'PublisherMarkdown',
  props: {
    nodes: { type: Array as PropType<readonly RichTextNode[]>, default: null },
    source: { type: String, default: '' },
    profile: { type: String as PropType<RichTextProfile>, default: 'document', validator: (value: string) => (RICH_TEXT_PROFILES as readonly string[]).includes(value) },
    links: { type: Object as PropType<PublisherResolvedLinks>, default: () => ({ documents: {}, assets: {} }) },
  },
  setup(props) {
    return () => h('div', { class: publisherClasses.article }, renderPublisherMarkdown(props.nodes ?? parseRichText(props.source, props.profile), props.links))
  },
})
</script>
