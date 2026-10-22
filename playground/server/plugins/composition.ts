import pg from 'pg'
import { TEST_TYPES } from '../../../tests/support/types'
import { SITE } from '../../../tests/support/world'

/**
 * The playground's composition, as a host's Nitro plugin would be. It
 * registers the tests' own document types: the layer has none. Nobody is
 * signed in, and with `PLAYGROUND_DATABASE_URL` only the database is
 * supplied: it proves the layer composes, headless, in a host.
 */
export default defineNitroPlugin(async () => {
  providePublisherDocumentTypes(TEST_TYPES)
  providePublisherTitleTemplate({ format: ({ title }) => `${title} · Publisher playground` })
  // One site: a host serving several would answer each host name's tenant here.
  providePublisherSiteResolver({ resolve: async () => SITE })
  providePublisherSubjectResolver({ resolve: async () => null })
  const url = process.env.PLAYGROUND_DATABASE_URL
  if (!url) return
  providePublisherDatabase({ dialect: 'postgres', pool: new pg.Pool({ connectionString: url }) })
  await migratePublisherDatabase()
})
