<script lang="ts">
import type { PropType } from 'vue'
import { defineComponent, h } from 'vue'
import { parseRichText, RICH_TEXT_PROFILES, type RichTextProfile } from '@nuxt4-layers/rich-text'
import type { PublisherResolvedLinks } from '../../shared/contracts'
import { publisherClasses } from '../utils/publisher-classes'
import { renderPublisherMarkdown } from '../utils/publisher-markdown-render'

/**
 * PUBLIC. Renders rich text safely anywhere: parsed to `rich-text`'s safe
 * tree for its field's `profile` and drawn as VNodes, never as HTML. `links` gives
 * the addresses of `doc:` links and `asset:` images; without it they render
 * as text and nothing.
 */
export default defineComponent({
  name: 'PublisherMarkdown',
  props: {
    source: { type: String, required: true },
    profile: { type: String as PropType<RichTextProfile>, default: 'document', validator: (value: string) => (RICH_TEXT_PROFILES as readonly string[]).includes(value) },
    links: { type: Object as PropType<PublisherResolvedLinks>, default: () => ({ documents: {}, assets: {} }) },
  },
  setup(props) {
    return () => h('div', { class: publisherClasses.article }, renderPublisherMarkdown(parseRichText(props.source, props.profile), props.links))
  },
})
</script>
