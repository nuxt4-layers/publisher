import { createError, defineEventHandler } from 'h3'
import { appraisal, bulletin, landing } from '../../../../tests/support/types'
import { id, person } from '../../../../tests/support/world'
import { pool, testMode, world } from '../../plugins/composition'

/**
 * Browser tests only: an editor (Alice) who may do everything, an approver
 * (Bob) and a reader with no permission (Carol); a published landing at
 * `/welcome` linking to a published bulletin, a draft, a renamed bulletin
 * whose old address redirects, and a submission awaiting moderation.
 */
export default defineEventHandler(async () => {
  if (!testMode || !pool) throw createError({ statusCode: 404 })
  const { rows } = await pool.query<{ tablename: string }>(`select "tablename" from pg_tables where "schemaname" = 'publisher' and "tablename" <> 'migration'`)
  if (rows.length > 0) await pool.query(`truncate ${rows.map(row => `"publisher"."${row.tablename}"`).join(', ')} restart identity cascade`)
  world.grants.clear()
  world.approvals.clear()
  const [alice, bob, carol] = [id(), id(), id()]
  for (const type of ['landing', 'appraisal', 'bulletin']) world.grantAll(alice, type)
  world.grant(bob, 'publisher.landing.view-draft')
  const editor = person(alice, new Date())
  const act = (documentId: string, request: Parameters<typeof transitionPublisherDocument>[0]['request']) =>
    transitionPublisherDocument({ subject: editor, correlationId: id(), documentId, request })

  const news = await createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('first-news', 'First news') })
  await act(news.id, { action: 'publish', expectedVersion: 1 })
  await act(news.id, { action: 'save', expectedVersion: 1, content: bulletin('renamed-news', 'Renamed news') })
  await act(news.id, { action: 'publish', expectedVersion: 2 })

  const welcome = await createPublisherDocument({
    subject: editor,
    correlationId: id(),
    type: 'landing',
    content: landing('welcome', 'Welcome', `Read [the news](doc:${news.id}).\n\n![A red door](asset:door-1)\n\n<script>document.title = 'owned'</script>`),
  })
  await act(welcome.id, { action: 'submit', expectedVersion: 1 })
  world.approve(world.approvalFor(welcome.id)!, bob)
  await act(welcome.id, { action: 'publish', expectedVersion: 1 })

  const draft = await createPublisherDocument({ subject: editor, correlationId: id(), type: 'bulletin', content: bulletin('unfinished', 'Unfinished') })
  const { documentId: submission } = await receivePublisherSubmission({ correlationId: id(), submitterId: carol, type: 'appraisal', content: appraisal(carol) })
  return { alice, bob, carol, welcome: welcome.id, news: news.id, draft: draft.id, submission }
})
