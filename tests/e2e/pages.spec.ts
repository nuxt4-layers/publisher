import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { ORIGIN } from './constants'

/**
 * The public and administration pages in a real browser, against the built
 * playground with Theme Manager's styles and the tests' own document types:
 * one `<main>` each, axe against WCAG 2.2 AA in light and dark mode, safe
 * Markdown, metadata, redirects, and editing, publishing and moderating.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

interface Scenario { alice: string, bob: string, carol: string, welcome: string, news: string, draft: string, submission: string }

async function seed(request: APIRequestContext): Promise<Scenario> {
  const response = await request.post('/api/__playground/seed')
  expect(response.ok()).toBe(true)
  return response.json()
}

/** Stands in for Authentication: the playground reads the signed-in identity from this cookie in test mode. */
async function signInAs(context: BrowserContext, identityId: string | null) {
  await context.clearCookies()
  if (identityId) await context.addCookies([{ name: 'publisher_playground_subject', value: identityId, url: ORIGIN }])
}

/** One `<main>`, then axe in light mode, in dark mode (Theme Manager's `dark` class), and back. */
async function expectAccessible(page: Page) {
  await expect(page.locator('main')).toHaveCount(1)
  for (const dark of [false, true]) {
    await page.evaluate(on => document.documentElement.classList.toggle('dark', on), dark)
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations.map(v => `${dark ? 'dark' : 'light'} ${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

test.describe('public pages', () => {
  test('renders a published document of a registered type at its address, with its metadata', async ({ page, context, request }) => {
    await seed(request)
    await signInAs(context, null)
    const response = await page.goto('/welcome')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible()
    await expect(page).toHaveTitle('Welcome · Publisher playground')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${ORIGIN}/welcome`)
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Welcome')
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Welcome summary')
    await expectAccessible(page)
  })

  test('renders Markdown safely: doc: links to the current address, asset images with alt text, raw HTML as text', async ({ page, request }) => {
    await seed(request)
    await page.goto('/welcome')
    await expect(page.getByRole('link', { name: 'the news' })).toHaveAttribute('href', '/bulletins/2026/10/21/renamed-news')
    await expect(page.getByRole('img', { name: 'A red door' })).toHaveAttribute('src', '/door.svg')
    await expect(page.getByText('<script>document.title = \'owned\'</script>')).toBeVisible()
    await expect(page).not.toHaveTitle('owned')
  })

  test('redirects an old address to the document\'s current one', async ({ page, request }) => {
    await seed(request)
    const response = await page.goto('/bulletins/2026/10/21/first-news')
    expect(response?.url()).toBe(`${ORIGIN}/bulletins/2026/10/21/renamed-news`)
    await expect(page.getByRole('heading', { level: 1, name: 'Renamed news' })).toBeVisible()
    await expectAccessible(page)
  })

  test('answers a draft exactly as a missing document: the designed not-found page, status 404', async ({ page, context, request }) => {
    const scenario = await seed(request)
    for (const who of [null, scenario.carol]) {
      await signInAs(context, who)
      const missing = await page.goto('/nothing-here')
      expect(missing?.status()).toBe(404)
      const missingText = await page.locator('main').innerText()
      await expectAccessible(page)
      const draft = await page.goto('/bulletins/2026/10/21/unfinished?preview=1')
      expect(draft?.status()).toBe(404)
      expect(await page.locator('main').innerText()).toBe(missingText)
    }
  })

  test('previews a draft for someone who may view drafts, marked as a preview and never indexed', async ({ page, context, request }) => {
    const scenario = await seed(request)
    await signInAs(context, scenario.alice)
    await page.goto('/bulletins/2026/10/21/unfinished?preview=1')
    await expect(page.getByRole('heading', { level: 1, name: 'Unfinished' })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Preview')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    await expectAccessible(page)
  })
})

test.describe('administration pages', () => {
  test('asks a signed-out visitor to sign in, and tells a reader without permission nothing more', async ({ page, context, request }) => {
    const scenario = await seed(request)
    await signInAs(context, null)
    await page.goto('/publisher')
    await expect(page.getByRole('alert')).toContainText('Sign in')
    await expectAccessible(page)
    await signInAs(context, scenario.carol)
    await page.goto(`/publisher/documents/${scenario.draft}`)
    await expect(page.getByRole('alert')).toBeVisible()
    await expectAccessible(page)
  })

  test('protects the administration pages from framing, caching and referrer leaks', async ({ request }) => {
    const scenario = await seed(request)
    for (const path of ['/publisher', `/publisher/documents/${scenario.draft}`, '/publisher/moderation']) {
      const response = await request.get(path)
      expect(response.headers()['x-frame-options'], path).toBe('DENY')
      expect(response.headers()['cache-control'], path).toBe('no-store')
      expect(response.headers()['referrer-policy'], path).toBe('no-referrer')
    }
  })

  test('lists documents by type with search, and creates one from the type\'s own form', async ({ page, context, request }) => {
    const scenario = await seed(request)
    await signInAs(context, scenario.alice)
    await page.goto('/publisher')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.getByLabel('Type').selectOption('bulletin')
    await expect(page.getByRole('link', { name: 'Renamed news' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Unfinished' })).toBeVisible()
    await page.getByLabel('Search').fill('Unfin')
    await expect(page.getByRole('link', { name: 'Renamed news' })).toHaveCount(0)
    await expectAccessible(page)

    await page.getByRole('button', { name: 'New Bulletin' }).click()
    await page.getByLabel('Title').fill('Made in the browser')
    await page.getByLabel('Slug').fill('made-in-the-browser')
    await page.getByLabel('body').fill('Hello **world**.')
    await page.getByLabel('topic').fill('general')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Made in the browser' })).toBeVisible()
    await expectAccessible(page)
  })

  test('edits, saves, publishes and restores a document by keyboard, with its history and links', async ({ page, context, request }) => {
    const scenario = await seed(request)
    await signInAs(context, scenario.alice)
    await page.goto(`/publisher/documents/${scenario.news}`)
    await expect(page.getByRole('heading', { level: 2, name: 'History' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Linked from' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Welcome' })).toBeVisible()
    await expectAccessible(page)

    await page.getByLabel('Title').fill('Edited news')
    await page.getByRole('button', { name: 'Save' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toContainText('Saved')
    await page.getByRole('button', { name: 'Publish' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toContainText('Published')
    await page.goto('/bulletins/2026/10/21/renamed-news')
    await expect(page.getByRole('heading', { level: 1, name: 'Edited news' })).toBeVisible()

    await page.goto(`/publisher/documents/${scenario.news}`)
    await page.getByRole('button', { name: 'Restore version 1' }).click()
    await expect(page.getByLabel('Title')).toHaveValue('First news')
  })

  test('refuses to unpublish a linked document until the links are acknowledged', async ({ page, context, request }) => {
    const scenario = await seed(request)
    await signInAs(context, scenario.alice)
    await page.goto(`/publisher/documents/${scenario.news}`)
    await page.getByRole('button', { name: 'Unpublish' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('1')
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Unpublish anyway' }).click()
    await expect(page.getByRole('status')).toContainText('Unpublished')
  })

  test('moderates a submission, which appears only once accepted', async ({ page, context, request }) => {
    const scenario = await seed(request)
    await signInAs(context, scenario.alice)
    await page.goto('/publisher/moderation')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const submission = page.getByRole('article')
    await expect(submission).toHaveCount(1)
    await expectAccessible(page)
    await submission.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByRole('status')).toContainText('Accepted')
    await expect(page.getByRole('article')).toHaveCount(0)
  })

  test('reflows to a narrow screen without horizontal scrolling', async ({ page, context, request }) => {
    const scenario = await seed(request)
    await signInAs(context, scenario.alice)
    await page.setViewportSize({ width: 320, height: 640 })
    for (const path of ['/welcome', '/publisher', `/publisher/documents/${scenario.news}`, '/publisher/moderation']) {
      await page.goto(path)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true)
    }
  })
})
