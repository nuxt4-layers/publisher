/**
 * The shared Markdown dialect, agreed with `content-editor`
 * (docs/contracts.md §6). These constants are the contract; the parser and
 * renderer live in `markdown/` and `app/`.
 */

/** CommonMark, plus these GitHub Flavored Markdown extensions only. Raw HTML is never allowed. */
export const PUBLISHER_MARKDOWN_EXTENSIONS = ['gfm-table', 'gfm-strikethrough'] as const

/** The only link destinations kept: anything else renders as its text. */
export const PUBLISHER_LINK_SCHEMES = ['https:', 'mailto:', 'doc:', 'asset:'] as const

/** A link to another document, by id: `[text](doc:<uuid>)`. */
export const DOC_LINK_PATTERN = /^doc:([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/

/** An image from the host's asset store: `![alt](asset:<id>)`. */
export const ASSET_LINK_PATTERN = /^asset:([A-Za-z0-9][A-Za-z0-9._-]{0,199})$/

/** A site-relative link: one leading `/`, never `//`. */
export const SITE_LINK_PATTERN = /^\/(?!\/)[^\s\\]*$/
