import { pending } from '../shared/pending'

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

/** Parses Markdown in the dialect into its safe tree. Never throws on any input. */
export function parsePublisherMarkdown(source: string): PublisherMarkdownNode[] {
  return pending(`parsePublisherMarkdown(${source.length})`)
}

/** What saving this source needs to know: its problems and the documents and assets it names. */
export function checkPublisherMarkdown(source: string): PublisherMarkdownCheck {
  return pending(`checkPublisherMarkdown(${source.length})`)
}
