import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { checkPublisherMarkdown, parsePublisherMarkdown } from '../markdown/dialect'
import { renderPublisherMarkdown } from '../app/utils/publisher-markdown-render'
import type { PublisherResolvedLinks } from '../shared/contracts'

const target = '01928c4e-0000-7000-8000-000000000042'

async function render(source: string, links: PublisherResolvedLinks = { documents: {}, assets: {} }): Promise<string> {
  return renderToString(h('div', renderPublisherMarkdown(parsePublisherMarkdown(source), links)))
}

describe('the shared Markdown dialect', () => {
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

  it('refuses an image without alt text, or from anywhere but the asset store, and lists what a source names', () => {
    expect(checkPublisherMarkdown('![](asset:door-1)').problems).toEqual(['image-without-alt'])
    expect(checkPublisherMarkdown('![   ](asset:door-1)').problems).toEqual(['image-without-alt'])
    expect(checkPublisherMarkdown('![A door](https://example.org/door.png)').problems).toEqual(['image-not-asset'])
    const checked = checkPublisherMarkdown(`![A door](asset:door-1) [a](doc:${target}) [b](doc:${target}) ![Again](asset:door-1)`)
    expect(checked).toEqual({ problems: [], documentIds: [target], assetIds: ['door-1'] })
  })

  it('never throws, whatever the input', () => {
    for (const source of ['', '['.repeat(10_000), '\u0000', '| a |\n|', '<'.repeat(5000), '*'.repeat(5000)]) {
      expect(() => parsePublisherMarkdown(source)).not.toThrow()
    }
  })
})
