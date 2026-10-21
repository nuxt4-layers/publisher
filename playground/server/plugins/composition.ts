import pg from 'pg'
import { getCookie } from 'h3'
import type { H3Event } from 'h3'
import { UUID_V7_PATTERN } from '../../../shared/contracts'
import { TEST_TYPES } from '../../../tests/support/types'
import { World } from '../../../tests/support/world'

/**
 * The playground's composition, as a host's Nitro plugin would be. It
 * registers the tests' own document types: the layer has none.
 *
 * By default nobody is signed in and, with `PLAYGROUND_DATABASE_URL`, only
 * the database is supplied: it only proves the layer composes.
 *
 * With PUBLISHER_PLAYGROUND_TEST=1 (browser tests only), Authorisation and
 * the approvals process are the in-memory stand-ins the tests use, the
 * signed-in identity comes from the `publisher_playground_subject` cookie
 * (standing in for Authentication), and `/api/__playground/seed` sets the
 * scene. None of it is fit for production.
 */
export const testMode = process.env.PUBLISHER_PLAYGROUND_TEST === '1'
export const world = new World()
export let pool: pg.Pool | null = null

export default defineNitroPlugin(async () => {
  providePublisherDocumentTypes(TEST_TYPES)
  providePublisherTitleTemplate({ format: ({ title }) => `${title} · Publisher playground` })
  providePublisherSubjectResolver({
    async resolve(event) {
      if (!testMode) return null
      const identityId = getCookie(event as H3Event, 'publisher_playground_subject')
      if (!identityId || !UUID_V7_PATTERN.test(identityId)) return null
      return { identityId, kind: 'person', assurance: { level: 'aal2', phishingResistant: true, authenticatedAt: new Date().toISOString() } }
    },
  })
  const url = process.env.PLAYGROUND_DATABASE_URL
  if (!url) return
  pool = new pg.Pool({ connectionString: url })
  providePublisherDatabase({ dialect: 'postgres', pool })
  await migratePublisherDatabase()
  if (!testMode) return
  world.time = new Date()
  world.assets.set('door-1', '/door.svg')
  providePublisherAccessDecision(world.access)
  providePublisherApproval(world.approval)
  providePublisherEventSink(world.sink)
  providePublisherAssetResolver(world.assetResolver)
  await checkPublisherComposition()
})
