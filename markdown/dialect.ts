import type { Definition, Nodes, Parents, PhrasingContent, Root, RootContent, Table } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmTable } from 'micromark-extension-gfm-table'
import { ASSET_LINK_PATTERN, DOC_LINK_PATTERN, SITE_LINK_PATTERN } from '../shared/contracts'

/**
 * The shared Markdown dialect's parser (docs/contracts.md §6), used by the
 * server (checking on save, extracting links) and by `PublisherMarkdown`
 * (rendering). It answers a tree of the dialect's own nodes only: anything
 * else in the source (raw HTML, other link schemes) becomes text, so no
 * renderer can be handed markup.
 */

export type PublisherMarkdownNode =
  | { kind: 'text', value: string }
  | { kind: 'paragraph' | 'emphasis' | 'strong' | 'delete' | 'blockquote' | 'list-item', children: PublisherMarkdownNode[] }
  | { kind: 'heading', depth: 1 | 2 | 3 | 4 | 5 | 6, children: PublisherMarkdownNode[] }
  | { kind: 'list', ordered: boolean, start: number | null, children: PublisherMarkdownNode[] }
  | { kind: 'code', value: string, inline: boolean }
  | { kind: 'link', href: string, children: PublisherMarkdownNode[] }
  | { kind: 'document-link', documentId: string, children: PublisherMarkdownNode[] }
  | { kind: 'image', assetId: string, alt: string }
  | { kind: 'table', align: ('left' | 'right' | 'center' | null)[], rows: PublisherMarkdownNode[][][] }
  | { kind: 'break' }
  | { kind: 'rule' }

export interface PublisherMarkdownCheck {
  /** Content problems: `image-without-alt`, `image-not-asset`. Empty when the source may be saved. */
  problems: string[]
  /** Every `doc:` target, once each. */
  documentIds: string[]
  /** Every `asset:` image, once each. */
  assetIds: string[]
}

/** Constructs nested deeper than this become text: the dialect bounds the tree a renderer walks. */
const MAX_DEPTH = 64

function syntaxTree(source: string): Root {
  return fromMarkdown(source, {
    extensions: [gfmTable(), gfmStrikethrough({ singleTilde: false })],
    mdastExtensions: [gfmTableFromMarkdown(), gfmStrikethroughFromMarkdown()],
  })
}

function definitions(tree: Root): Map<string, Definition> {
  const found = new Map<string, Definition>()
  const visit = (node: Nodes) => {
    if (node.type === 'definition' && !found.has(node.identifier)) found.set(node.identifier, node)
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(tree)
  return found
}

/** The plain text of a syntax node, as written. */
function textOf(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if ('children' in node) return (node.children as Nodes[]).map(textOf).join('')
  return ''
}

/** A link destination the dialect keeps, as a node, or `null` to render its text alone. */
function linkTarget(url: string): { kind: 'link', href: string } | { kind: 'document-link', documentId: string } | null {
  const document = DOC_LINK_PATTERN.exec(url)
  if (document) return { kind: 'document-link', documentId: document[1]! }
  if (ASSET_LINK_PATTERN.test(url)) return { kind: 'link', href: url }
  if (SITE_LINK_PATTERN.test(url)) return { kind: 'link', href: url }
  if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(url)) return { kind: 'link', href: url }
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return { kind: 'link', href: url }
  }
  catch {}
  return null
}

function convert(node: Nodes, defined: Map<string, Definition>, depth: number): PublisherMarkdownNode[] {
  if (depth > MAX_DEPTH) return [{ kind: 'text', value: textOf(node) }]
  const children = (parent: Parents) => (parent.children as Nodes[]).flatMap(child => convert(child, defined, depth + 1))
  switch (node.type) {
    case 'root': return children(node)
    case 'text': return [{ kind: 'text', value: node.value }]
    // Raw HTML is never markup: it is the text written.
    case 'html': return [{ kind: 'text', value: node.value }]
    case 'paragraph': return [{ kind: 'paragraph', children: children(node) }]
    case 'emphasis': return [{ kind: 'emphasis', children: children(node) }]
    case 'strong': return [{ kind: 'strong', children: children(node) }]
    case 'delete': return [{ kind: 'delete', children: children(node) }]
    case 'blockquote': return [{ kind: 'blockquote', children: children(node) }]
    case 'heading': return [{ kind: 'heading', depth: node.depth, children: children(node) }]
    case 'list': return [{ kind: 'list', ordered: node.ordered === true, start: node.ordered ? node.start ?? 1 : null, children: children(node) }]
    case 'listItem': {
      // A tight list's items hold their text directly.
      const items = node.spread ? children(node) : node.children.flatMap(child => child.type === 'paragraph' ? children(child) : convert(child, defined, depth + 1))
      return [{ kind: 'list-item', children: items }]
    }
    case 'code': return [{ kind: 'code', value: node.value, inline: false }]
    case 'inlineCode': return [{ kind: 'code', value: node.value, inline: true }]
    case 'break': return [{ kind: 'break' }]
    case 'thematicBreak': return [{ kind: 'rule' }]
    case 'definition': return []
    case 'link':
    case 'linkReference': {
      const url = node.type === 'link' ? node.url : defined.get(node.identifier)?.url
      const target = url === undefined ? null : linkTarget(url)
      const inner = children(node)
      if (node.type === 'linkReference' && url === undefined) return [{ kind: 'text', value: '[' }, ...inner, { kind: 'text', value: ']' }]
      return target ? [{ ...target, children: inner }] : inner
    }
    case 'image':
    case 'imageReference': {
      const url = node.type === 'image' ? node.url : defined.get(node.identifier)?.url
      const asset = url === undefined ? null : ASSET_LINK_PATTERN.exec(url)
      const alt = (node.alt ?? '').trim()
      return asset && alt ? [{ kind: 'image', assetId: asset[1]!, alt }] : alt ? [{ kind: 'text', value: alt }] : []
    }
    case 'table': return [table(node, defined, depth)]
    default: return 'children' in node ? children(node as Parents) : 'value' in node && typeof node.value === 'string' ? [{ kind: 'text', value: node.value }] : []
  }
}

function table(node: Table, defined: Map<string, Definition>, depth: number): PublisherMarkdownNode {
  return {
    kind: 'table',
    align: (node.align ?? []).map(align => align ?? null),
    rows: node.children.map(row => row.children.map(cell => (cell.children as PhrasingContent[]).flatMap(child => convert(child, defined, depth + 2)))),
  }
}

/** Parses Markdown in the dialect into its safe tree. Never throws on any input. */
export function parsePublisherMarkdown(source: string): PublisherMarkdownNode[] {
  try {
    const tree = syntaxTree(source)
    return convert(tree, definitions(tree), 0)
  }
  catch {
    return source ? [{ kind: 'paragraph', children: [{ kind: 'text', value: source }] }] : []
  }
}

/** What saving this source needs to know: its problems and the documents and assets it names. */
export function checkPublisherMarkdown(source: string): PublisherMarkdownCheck {
  const problems = new Set<string>()
  const documentIds = new Set<string>()
  const assetIds = new Set<string>()
  let tree: Root
  try {
    tree = syntaxTree(source)
  }
  catch {
    return { problems: [], documentIds: [], assetIds: [] }
  }
  const defined = definitions(tree)
  const visit = (node: Nodes | RootContent) => {
    if (node.type === 'image' || node.type === 'imageReference') {
      const url = node.type === 'image' ? node.url : defined.get(node.identifier)?.url ?? ''
      const asset = ASSET_LINK_PATTERN.exec(url)
      if (!asset) problems.add('image-not-asset')
      else if (!(node.alt ?? '').trim()) problems.add('image-without-alt')
      else assetIds.add(asset[1]!)
    }
    if (node.type === 'link' || node.type === 'linkReference') {
      const url = node.type === 'link' ? node.url : defined.get(node.identifier)?.url ?? ''
      const document = DOC_LINK_PATTERN.exec(url)
      if (document) documentIds.add(document[1]!)
    }
    if ('children' in node) for (const child of node.children as Nodes[]) visit(child)
  }
  visit(tree)
  return { problems: [...problems], documentIds: [...documentIds], assetIds: [...assetIds] }
}
