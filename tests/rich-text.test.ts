import { parseRichText, richTextTreeSchema } from '@nuxt4-layers/rich-text'
import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderPublisherMarkdown } from '../app/utils/publisher-markdown-render'
import type { PublisherResolvedLinks, PublisherSubject } from '../shared/contracts'
import { clearPublisherComposition } from '../server/utils/publisher-composition'
import {
  createPublisherDocument,
  exportPublisherContent,
  getPublishedDocument,
  importPublisherContent,
  receivePublisherSubmission,
  resolvePublisherPath,
  transitionPublisherDocument,
} from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { appraisal, bulletin, landing } from './support/types'
import { id, person, SITE } from './support/world'

requireDatabaseInCi()

const target = '01928c4e-0000-7000-8000-000000000042'

async function render(source: string, links: PublisherResolvedLinks = { documents: {}, assets: {} }): Promise<string> {
  return renderToString(h('div', renderPublisherMarkdown(parseRichText(source, 'document'), links)))
}

describe('drawing rich-text\'s safe tree', () => {
  it('renders CommonMark with GFM tables and strikethrough', async () => {
    const html = await render('# Title\n\nSome *emphasis*, **strong** and ~~struck~~ text.\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- one\n- two\n\n```\ncode <b>\n```')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<em>emphasis</em>')
    expect(html).toContain('<strong>strong</strong>')
    expect(html).toContain('<del>struck</del>')
    expect(html).toMatch(/<table>[\s\S]*<th>a<\/th>[\s\S]*<td[^>]*>2<\/td>/)
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('code &lt;b&gt;')
  })

  it('renders script, event handlers and raw HTML harmlessly, as text', async () => {
    const html = await render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\nText <span onclick="alert(1)">inline</span> <iframe src="https://evil.example"></iframe>')
    // Written markup appears as text; no element or attribute is ever created from it.
    expect(html).not.toMatch(/<(?:script|img|span|iframe)\b|<[^>]*\son\w+=/i)
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps only https, mailto, doc, asset and site-relative links; the rest render as their text', async () => {
    const html = await render([
      '[safe](https://example.org/a)',
      '[mail](mailto:hello@example.org)',
      '[local](/about)',
      '[script](javascript:alert(1))',
      '[encoded](jav&#x61;script:alert(1))',
      '[data](data:text/html;base64,PHNjcmlwdD4=)',
      '[plain](http://example.org)',
      '[protocol-relative](//evil.example)',
      '[vb](vbscript:msgbox)',
      '<javascript:alert(1)>',
    ].join('\n\n'))
    expect(html).toContain('href="https://example.org/a"')
    expect(html).toContain('href="mailto:hello@example.org"')
    expect(html).toContain('href="/about"')
    expect(html).not.toMatch(/href="(?:javascript:|data:|vbscript:|http:|\/\/)/i)
    for (const text of ['script', 'data', 'plain', 'protocol-relative', 'vb']) expect(html).toContain(text)
  })

  it('resolves doc: links to the target\'s address, or renders their text when it is not published', async () => {
    expect(await render(`[the target](doc:${target})`, { documents: { [target]: '/somewhere' }, assets: {} })).toContain('<a href="/somewhere">the target</a>')
    const unpublished = await render(`[the target](doc:${target})`, { documents: { [target]: null }, assets: {} })
    expect(unpublished).toContain('the target')
    expect(unpublished).not.toContain('<a')
    expect(await render('[bad](doc:not-a-uuid)')).not.toContain('<a')
  })

  it('draws asset: images through the host\'s resolver, with their alt text, and nothing else as an image', async () => {
    const html = await render('![A red door](asset:door-1)\n\n![Elsewhere](https://evil.example/x.png)', { documents: {}, assets: { 'door-1': { url: 'https://cdn.example/door.jpg', width: 800, height: 600 } } })
    expect(html).toMatch(/<img[^>]+src="https:\/\/cdn.example\/door.jpg"[^>]+alt="A red door"/)
    expect(html.match(/<img/g)).toHaveLength(1)
    expect(await render('![Gone](asset:missing)')).not.toContain('<img')
  })

  it('never throws, whatever the input', () => {
    for (const source of ['', '['.repeat(10_000), '\u0000', '| a |\n|', '<'.repeat(5000), '*'.repeat(5000)]) {
      expect(() => parseRichText(source, 'document')).not.toThrow()
    }
  })
})

describe.skipIf(!hasDatabase)('formatted fields, checked against their profiles on every route (PostgreSQL)', () => {
  let harness: Harness
  let editor: PublisherSubject
  const table = '| a |\n|---|\n| 1 |'

  beforeAll(async () => {
    harness = await Harness.open()
    const world = await harness.reset()
    const alice = id()
    for (const type of ['landing', 'appraisal', 'bulletin']) world.grantAll(alice, type)
    editor = person(alice, world.time)
  })

  afterAll(async () => {
    clearPublisherComposition()
    await harness?.close()
  })

  it('refuses anything beyond a field\'s profile on create and save, and takes what it allows', async () => {
    // `intro` is a block field: headings and lists, never a table.
    await expect(createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'landing', content: landing('tabled', 'Tabled', table) }))
      .rejects.toMatchObject({ code: 'validation-failed', reason: 'not-in-profile' })
    const page = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'landing', content: landing('listed', 'Listed', '## Why\n\n- because') })
    await expect(transitionPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), documentId: page.id, request: { action: 'save', expectedVersion: 1, content: landing('listed', 'Listed', '![A door](asset:door-1)') } }))
      .rejects.toMatchObject({ code: 'validation-failed', reason: 'not-in-profile' })
    // The same table is fine in a document field.
    await expect(createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: { ...bulletin('tabled'), fields: { body: table, topic: 'general' } } })).resolves.toBeDefined()
  })

  it('refuses it in a submission', async () => {
    await expect(receivePublisherSubmission({ siteId: SITE, correlationId: id(), submitterId: id(), type: 'appraisal', content: appraisal(id(), { words: table }) }))
      .rejects.toMatchObject({ code: 'validation-failed', reason: 'not-in-profile' })
  })

  it('refuses it on import', async () => {
    const exported = await exportPublisherContent({ siteId: SITE, types: ['landing'] })
    const source = exported.documents[0]!
    const tabled = { ...exported, documents: [{ ...source, id: id(), versions: source.versions.map(version => ({ ...version, content: { ...version.content, slug: 'imported', fields: { ...version.content.fields, intro: table } } })) }] }
    await expect(importPublisherContent({ siteId: SITE, bundle: tabled, correlationId: id() })).rejects.toMatchObject({ code: 'validation-failed', reason: 'not-in-profile' })
  })

  it('stores formatted text in one form, and never reads a plain field as rich text', async () => {
    const decomposed = 'Cafe\u0301\r\nmenu'
    const document = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'bulletin', content: { ...bulletin('plain', '**Not bold**'), fields: { body: decomposed, topic: 'general' } } })
    expect(document.fields.body).toBe('Caf\u00e9\nmenu')
    await transitionPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), documentId: document.id, request: { action: 'publish', expectedVersion: 1 } })
    const rendered = await getPublishedDocument({ siteId: SITE, documentId: document.id })
    expect(rendered!.document.title).toBe('**Not bold**')
    expect(rendered!.richText).toEqual([{ path: 'body', profile: 'document', nodes: [{ kind: 'paragraph', children: [{ kind: 'text', value: 'Caf\u00e9\nmenu' }] }] }])
  })

  it('answers formatted fields as safe trees, each at its own path, with nothing unsafe in any answer', async () => {
    const hostile = '<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](data:text/html,1) <img src=x onerror="alert(1)">'
    const page = await createPublisherDocument({ siteId: SITE, subject: editor, correlationId: id(), type: 'landing', content: { ...landing('trees', 'Trees', `**Bold** ${hostile}`), fields: { intro: `**Bold** ${hostile}`, section: 'products', blocks: [{ block: 'prose', body: 'One.' }, { block: 'prose', body: hostile }] } } })
    const answers = [
      await getPublishedDocument({ siteId: SITE, documentId: page.id, preview: true, viewer: editor }),
      await resolvePublisherPath({ siteId: SITE, path: '/trees', preview: true, viewer: editor }),
    ]
    const rendered = answers[0]!
    expect(rendered.richText.map(entry => [entry.path, entry.profile])).toEqual([['intro', 'block'], ['blocks[0].body', 'document'], ['blocks[1].body', 'document']])
    expect(rendered.richText[0]!.nodes[0]).toMatchObject({ kind: 'paragraph', children: expect.arrayContaining([expect.objectContaining({ kind: 'strong' })]) })
    for (const answer of answers) {
      const entries = answer && 'rendered' in answer ? answer.rendered.richText : (answer as typeof rendered).richText
      for (const entry of entries) expect(richTextTreeSchema.safeParse(entry.nodes).success, entry.path).toBe(true)
      const json = JSON.stringify(entries)
      expect(json).not.toMatch(/"kind":"(?:html|raw)"|"href":"(?:javascript|data|vbscript):/i)
      expect(json).toContain('<script>alert(1)</script>')
    }
  })
})
