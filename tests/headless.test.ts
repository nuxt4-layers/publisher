import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toPosix } from './support/paths'

/**
 * ADR-0009: the publisher is headless. It offers contracts, server functions,
 * an HTTP API, events, ports, data formats and a typed client; never screens,
 * routes, components, slots, styling or display wording. Presentation lives
 * in `ui`, a kit or the host.
 */

const root = join(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  exports: Record<string, string>
  files: string[]
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function files(dir: string): string[] {
  const absolute = join(root, dir)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => toPosix(join(entry.parentPath, entry.name)).slice(toPosix(root).length + 1))
}

/** Every file the package ships: its directories' contents, and its single files. */
const shipped = manifest.files.flatMap(entry => existsSync(join(root, entry)) && statSync(join(root, entry)).isDirectory() ? files(entry) : [entry])

describe('a headless layer (ADR-0009)', () => {
  it('ships no screen, route, layout or component', () => {
    expect(shipped.filter(file => /\.vue$/.test(file))).toEqual([])
    expect(files('modules')).toEqual([])
    expect(manifest.files).not.toContain('modules')
  })

  it('ships no styling and depends on no design system', () => {
    expect(shipped.filter(file => /\.(?:css|scss|sass|less)$/.test(file))).toEqual([])
    expect(Object.keys(manifest.exports).filter(key => /css/.test(key))).toEqual([])
    const all = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }
    expect(Object.keys(all).filter(name => /theme-manager|tailwind|@axe-core|playwright/.test(name))).toEqual([])
  })

  it('ships no display wording, class map, pairings or slots', () => {
    expect(shipped.filter(file => /messages|classes|pairings|components|render/.test(file))).toEqual([])
  })

  it('offers a typed client only: data and actions, nothing a screen draws', () => {
    expect(files('app')).toEqual(['app/composables/usePublisher.ts'])
    const client = readFileSync(join(root, 'app/composables/usePublisher.ts'), 'utf8')
    const exported = [...client.matchAll(/^export (?:async )?(?:function|const|interface|type) (\w+)/gm)].map(([, name]) => name)
    expect(exported.sort()).toEqual(['PublisherErrorBody', 'PublisherTypeView', 'publisherErrorOf', 'usePublisher'])
    expect(client).not.toMatch(/usePublisherText|useHead|onMounted|\bref\(/)
  })
})
