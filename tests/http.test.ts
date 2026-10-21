import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EventHandler, H3Event } from 'h3'
import { createApp, createRouter, defineEventHandler, getRequestHeader, toWebHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { originRejected, publisherHttpError } from '../server/internal/http'
import { clearPublisherComposition, providePublisherSubjectResolver } from '../server/utils/publisher-composition'
import { createPublisherDocument, receivePublisherSubmission, transitionPublisherDocument } from '../server/utils/publisher-server'
import { hasDatabase, requireDatabaseInCi } from './support/database'
import { Harness } from './support/publisher'
import { toPosix } from './support/paths'
import { appraisal, bulletin } from './support/types'
import { id, person, World } from './support/world'

requireDatabaseInCi()

const API = fileURLToPath(new URL('../server/api/publisher', import.meta.url))

/** The endpoints of docs/contracts.md §14, and nothing else: no export, import, erasure, maintenance or relay. */
const ENDPOINTS = [
  'GET /api/publisher/resolve',
  'GET /api/publisher/documents',
  'GET /api/publisher/feeds/:type/rss',
  'GET /api/publisher/feeds/:type/atom',
  'GET /api/publisher/admin/types',
  'GET /api/publisher/admin/documents',
  'POST /api/publisher/admin/documents',
  'GET /api/publisher/admin/documents/:documentId',
  'POST /api/publisher/admin/documents/:documentId/actions',
  'GET /api/publisher/admin/documents/:documentId/history',
  'GET /api/publisher/admin/documents/:documentId/backlinks',
  'GET /api/publisher/admin/documents/:documentId/preview',
  'GET /api/publisher/admin/moderation',
]

/** Every endpoint file, routed as Nuxt routes it: `[param]` → `:param`, method from the suffix. */
function endpointFiles(directory: string = API): { file: string, method: string, route: string }[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return endpointFiles(path)
    const match = /^(.*)\.(get|post|put|patch|delete)\.ts$/.exec(toPosix(relative(API, path)))
    if (!match) throw new Error(`Unexpected file in server/api/publisher: ${entry.name}`)
    const route = `/api/publisher/${match[1]!}`.replace(/\[(\w+)\]/g, ':$1').replace(/\/index$/, '')
    return [{ file: path, method: match[2]!, route }]
  })
}

describe('the /api/publisher endpoints', () => {
  it('are exactly those the contract lists', () => {
    expect(endpointFiles().map(endpoint => `${endpoint.method.toUpperCase()} ${endpoint.route}`).sort()).toEqual([...ENDPOINTS].sort())
  })
})

describe.skipIf(!hasDatabase)('the /api/publisher endpoints over HTTP (PostgreSQL)', () => {
  let harness: Harness
  let world: World
  let handler: (request: Request) => Promise<Response>
  let resolverFails = false
  const alice = id()
  const carol = id()
  let weak = new Set<string>()

  async function call(method: string, url: string, options: { as?: string, body?: unknown, origin?: string | null } = {}) {
    const target = new URL(url, 'http://site.test')
    const headers: Record<string, string> = { 'content-type': 'application/json', 'host': target.host }
    if (options.as) headers['x-test-subject'] = options.as
    const origin = options.origin === undefined ? target.origin : options.origin
    if (origin) headers.origin = origin
    const response = await handler(new Request(target, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    const type = response.headers.get('content-type') ?? ''
    const json = type.includes('json') && text ? JSON.parse(text) : null
    return { status: response.status, data: json?.data ?? json, text, headers: response.headers }
  }

  async function draft(slug: string) {
    return createPublisherDocument({ subject: person(alice, world.time), correlationId: id(), type: 'bulletin', content: bulletin(slug, `Title ${slug}`) })
  }

  async function published(slug: string) {
    const document = await draft(slug)
    return transitionPublisherDocument({ subject: person(alice, world.time), correlationId: id(), documentId: document.id, request: { action: 'publish', expectedVersion: 1 } })
  }

  beforeAll(async () => {
    harness = await Harness.open()
    const app = createApp()
    const router = createRouter()
    app.use(defineEventHandler((event) => {
      if (originRejected(event)) throw publisherHttpError('forbidden')
    }))
    for (const endpoint of endpointFiles()) {
      const module = await import(endpoint.file) as { default: EventHandler }
      router[endpoint.method as 'get' | 'post'](endpoint.route, module.default)
    }
    app.use(router)
    handler = toWebHandler(app)
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    world = await harness.reset()
    resolverFails = false
    weak = new Set()
    for (const type of ['landing', 'appraisal', 'bulletin']) world.grantAll(alice, type)
    providePublisherSubjectResolver({
      async resolve(event) {
        if (resolverFails) throw new Error('authentication is down')
        const identityId = getRequestHeader(event as H3Event, 'x-test-subject')
        return identityId ? person(identityId, new Date(), weak.has(identityId) ? 'weak' : 'strong') : null
      },
    })
  })

  it('resolves a published path for anyone, and answers a draft exactly as a missing document', async () => {
    const live = await published('live')
    const hidden = await draft('hidden')
    const found = await call('GET', `/api/publisher/resolve?path=${encodeURIComponent(live.path!)}`)
    expect(found.status).toBe(200)
    expect(found.data).toMatchObject({ kind: 'document', rendered: { document: { id: live.id, title: 'Title live' } } })

    const missing = await call('GET', `/api/publisher/resolve?path=${encodeURIComponent('/bulletins/2026/10/21/nothing')}`)
    expect(missing.data).toEqual({ kind: 'none' })
    for (const as of [undefined, carol]) {
      for (const preview of ['', '&preview=1']) {
        const answer = await call('GET', `/api/publisher/resolve?path=${encodeURIComponent(hidden.path!)}${preview}`, { as })
        expect({ status: answer.status, data: answer.data }, `${as} ${preview}`).toEqual({ status: missing.status, data: missing.data })
      }
    }
    const preview = await call('GET', `/api/publisher/resolve?path=${encodeURIComponent(hidden.path!)}&preview=1`, { as: alice })
    expect(preview.data).toMatchObject({ kind: 'document', rendered: { preview: true } })
    expect(preview.headers.get('cache-control')).toBe('private, no-store')
  })

  it('lists and feeds published documents publicly, parsing queries strictly', async () => {
    await published('listed')
    await draft('unlisted')
    const listing = await call('GET', '/api/publisher/documents?type=bulletin&topic=general&limit=10')
    expect(listing.status).toBe(200)
    expect(listing.data.documents.map((document: { title: string }) => document.title)).toEqual(['Title listed'])
    expect((await call('GET', '/api/publisher/documents?type=bulletin&limit=1000')).status).toBe(400)
    expect((await call('GET', '/api/publisher/documents?type=bulletin&body=x')).data).toMatchObject({ code: 'validation-failed', reason: 'unknown-filter' })

    const rss = await call('GET', 'http://news.test/api/publisher/feeds/bulletin/rss')
    expect(rss.status).toBe(200)
    expect(rss.headers.get('content-type')).toMatch(/^application\/rss\+xml/)
    expect(rss.text).toContain('http://news.test/bulletins/2026/10/21/listed')
    const atom = await call('GET', 'http://news.test/api/publisher/feeds/bulletin/atom')
    expect(atom.headers.get('content-type')).toMatch(/^application\/atom\+xml/)
    expect((await call('GET', '/api/publisher/feeds/nothing/rss')).status).toBe(404)
  })

  it('takes the subject only from the host\'s resolver, never from a body', async () => {
    const body = { type: 'bulletin', content: bulletin('made') }
    expect((await call('POST', '/api/publisher/admin/documents', { body })).status).toBe(401)
    expect((await call('POST', '/api/publisher/admin/documents', { as: carol, body })).status).toBe(403)
    expect((await call('POST', '/api/publisher/admin/documents', { as: carol, body: { ...body, subject: { identityId: alice } } })).status).toBe(400)
    const made = await call('POST', '/api/publisher/admin/documents', { as: alice, body })
    expect(made.status).toBe(201)
    expect(made.data).toMatchObject({ type: 'bulletin', status: 'draft', version: 1 })
    expect((await call('GET', `/api/publisher/admin/documents/${made.data.id}`, { as: alice })).data.title).toBe('Bulletin')
  })

  it('runs the lifecycle through the actions endpoint, with optimistic locking and step-up', async () => {
    const document = await draft('acted')
    const url = `/api/publisher/admin/documents/${document.id}/actions`
    expect((await call('POST', url, { as: alice, body: { action: 'publish', expectedVersion: 2 } })).data).toMatchObject({ code: 'conflict', reason: 'version-stale' })
    expect((await call('POST', url, { as: alice, body: { action: 'publish', expectedVersion: 1, force: true } })).status).toBe(400)
    expect((await call('POST', url, { as: alice, body: { action: 'erase', expectedVersion: 1 } })).status).toBe(400)
    expect((await call('POST', url, { as: alice, body: { action: 'publish', expectedVersion: 1 } })).data).toMatchObject({ status: 'published' })
    expect((await call('GET', `/api/publisher/admin/documents/${document.id}/history`, { as: alice })).data).toHaveLength(1)
    expect((await call('GET', `/api/publisher/admin/documents/${document.id}/backlinks`, { as: alice })).data).toEqual([])
    expect((await call('GET', `/api/publisher/admin/documents/${document.id}/preview`, { as: alice })).data).toMatchObject({ preview: true })
    // A publish permission at `high` needs aal2.
    const page = await createPublisherDocument({ subject: person(alice, world.time), correlationId: id(), type: 'landing', content: { locale: 'en-GB', title: 'L', slug: 'l', fields: { intro: 'x', section: 'support', blocks: [] } } })
    await transitionPublisherDocument({ subject: person(alice, world.time), correlationId: id(), documentId: page.id, request: { action: 'submit', expectedVersion: 1 } })
    world.approve(world.approvalFor(page.id)!, id())
    weak.add(alice)
    expect((await call('POST', `/api/publisher/admin/documents/${page.id}/actions`, { as: alice, body: { action: 'publish', expectedVersion: 1 } })).data).toMatchObject({ code: 'insufficient-assurance' })
  })

  it('serves administration to those who hold `view-draft` only, and stays coarse', async () => {
    const document = await draft('admin')
    for (const path of [`/api/publisher/admin/documents/${document.id}`, `/api/publisher/admin/documents/${document.id}/history`, '/api/publisher/admin/documents?type=bulletin']) {
      expect((await call('GET', path)).status, path).toBe(401)
      expect((await call('GET', path, { as: carol })).status, path).toBe(403)
    }
    expect((await call('GET', `/api/publisher/admin/documents/${id()}`, { as: alice })).status).toBe(403)
    expect((await call('GET', '/api/publisher/admin/documents/not-an-id', { as: alice })).status).toBe(403)
    const types = await call('GET', '/api/publisher/admin/types', { as: alice })
    expect(types.data.map((type: { type: string }) => type.type).sort()).toEqual(['appraisal', 'bulletin', 'landing'])
    expect((await call('GET', '/api/publisher/admin/types', { as: carol })).data).toEqual([])
    await receivePublisherSubmission({ correlationId: id(), submitterId: carol, type: 'appraisal', content: appraisal(carol) })
    expect((await call('GET', '/api/publisher/admin/moderation', { as: alice })).data.total).toBe(1)
    const listed = await call('GET', '/api/publisher/admin/documents?type=bulletin&search=admin', { as: alice })
    expect(listed.data.documents.map((item: { id: string }) => item.id)).toEqual([document.id])
  })

  it('refuses state-changing requests without an Origin on the request\'s own host', async () => {
    const body = { type: 'bulletin', content: bulletin('origin') }
    expect((await call('POST', '/api/publisher/admin/documents', { as: alice, body, origin: null })).status).toBe(403)
    expect((await call('POST', '/api/publisher/admin/documents', { as: alice, body, origin: 'http://evil.test' })).status).toBe(403)
    expect((await call('POST', '/api/publisher/admin/documents', { as: alice, body })).status).toBe(201)
  })

  it('answers bad bodies with a problem code only', async () => {
    const bad = await call('POST', '/api/publisher/admin/documents', { as: alice, body: { type: 'bulletin', content: { ...bulletin('x'), fields: { body: '![](asset:a)', topic: 'general' } } } })
    expect(bad.data).toEqual({ code: 'validation-failed', messageKey: 'publisher.error.validation-failed', reason: 'image-without-alt' })
  })

  it('fails closed when the subject resolver or a port fails', async () => {
    resolverFails = true
    expect((await call('GET', '/api/publisher/admin/documents?type=bulletin', { as: alice })).status).toBe(503)
    resolverFails = false
    world.failing = true
    expect((await call('GET', '/api/publisher/admin/documents?type=bulletin', { as: alice })).status).toBe(503)
    world.failing = false
    clearPublisherComposition()
    expect((await call('GET', '/api/publisher/resolve?path=%2F')).status).toBe(503)
  })
})
