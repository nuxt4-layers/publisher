import type { VNode, VNodeArrayChildren } from 'vue'
import { createTextVNode, h } from 'vue'
import type { PublisherResolvedLinks } from '../../shared/contracts'
import type { PublisherMarkdownNode } from '../../markdown/dialect'

/**
 * Renders the dialect's safe tree to VNodes (docs/contracts.md §6.3): never
 * `v-html`. `doc:` links take the address `links` gives, or render as their
 * text; images take the asset's address, or render as nothing.
 */
export function renderPublisherMarkdown(nodes: readonly PublisherMarkdownNode[], links: PublisherResolvedLinks): VNode[] {
  return nodes.flatMap(node => renderNode(node, links)).map(child => typeof child === 'string' ? createTextVNode(child) : child)
}

function renderAll(nodes: readonly PublisherMarkdownNode[], links: PublisherResolvedLinks): VNodeArrayChildren {
  return nodes.flatMap(node => renderNode(node, links))
}

const ALIGN = { left: 'text-align:left', right: 'text-align:right', center: 'text-align:center' } as const

function renderNode(node: PublisherMarkdownNode, links: PublisherResolvedLinks): (VNode | string)[] {
  switch (node.kind) {
    case 'text': return [node.value]
    case 'paragraph': return [h('p', renderAll(node.children, links))]
    case 'emphasis': return [h('em', renderAll(node.children, links))]
    case 'strong': return [h('strong', renderAll(node.children, links))]
    case 'delete': return [h('del', renderAll(node.children, links))]
    case 'blockquote': return [h('blockquote', renderAll(node.children, links))]
    case 'heading': return [h(`h${node.depth}`, renderAll(node.children, links))]
    case 'list': return [h(node.ordered ? 'ol' : 'ul', node.ordered && node.start !== null && node.start !== 1 ? { start: node.start } : null, renderAll(node.children, links))]
    case 'list-item': return [h('li', renderAll(node.children, links))]
    case 'code': return node.inline ? [h('code', node.value)] : [h('pre', [h('code', node.value)])]
    case 'break': return [h('br')]
    case 'rule': return [h('hr')]
    case 'link': {
      const asset = /^asset:(.+)$/.exec(node.href)
      const href = asset ? links.assets[asset[1]!]?.url : node.href
      return href ? [h('a', { href }, renderAll(node.children, links))] : renderAll(node.children, links) as (VNode | string)[]
    }
    case 'document-link': {
      const href = links.documents[node.documentId]
      return href ? [h('a', { href }, renderAll(node.children, links))] : renderAll(node.children, links) as (VNode | string)[]
    }
    case 'image': {
      const asset = links.assets[node.assetId]
      return asset ? [h('img', { src: asset.url, alt: node.alt, width: asset.width, height: asset.height, loading: 'lazy' })] : []
    }
    case 'table': {
      const [head, ...body] = node.rows
      const cell = (tag: 'th' | 'td', content: PublisherMarkdownNode[], column: number) => {
        const align = node.align[column]
        return h(tag, align ? { style: ALIGN[align] } : null, renderAll(content, links))
      }
      return [h('table', [
        h('thead', [h('tr', (head ?? []).map((content, column) => cell('th', content, column)))]),
        ...(body.length ? [h('tbody', body.map(row => h('tr', row.map((content, column) => cell('td', content, column)))))] : []),
      ])]
    }
  }
}
