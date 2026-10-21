import type { VNode } from 'vue'
import type { PublisherResolvedLinks } from '../../shared/contracts'
import { pending } from '../../shared/pending'
import type { PublisherMarkdownNode } from '../../markdown/dialect'

/**
 * Renders the dialect's safe tree to VNodes (docs/contracts.md §6.3): never
 * `v-html`. `doc:` links take the address `links` gives, or render as their
 * text; images take the asset's address, or render as nothing.
 */
export function renderPublisherMarkdown(nodes: readonly PublisherMarkdownNode[], links: PublisherResolvedLinks): VNode[] {
  return pending(`renderPublisherMarkdown(${nodes.length}, ${Object.keys(links.documents).length})`)
}
