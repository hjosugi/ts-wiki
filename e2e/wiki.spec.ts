import { expect, test } from '@playwright/test'

// This flow owns a fresh database and cannot be replayed against the same
// server after setup has completed. The structural assertions below remain
// deterministic; visual pixels allow only minor host font/glow differences.
test.describe.configure({ retries: 0 })

test('owner setup, page creation, and search work through the production app', async ({ page }) => {
  await page.goto('/setup')
  await page.getByLabel('Site title').fill('E2E Wiki')
  await page.getByLabel('Display name').fill('E2E Owner')
  await page.getByLabel('Email').fill('owner@example.com')
  await page.getByLabel('Password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create wiki' }).click()
  await expect(page).toHaveURL(/\/home$/)

  const created = await page.evaluate(async () => {
    const token = localStorage.getItem('token')
    const response = await fetch('/api/pages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        path: 'e2e-release-page',
        title: 'E2E Release Page',
        content: '# Browser smoke\n\nA searchable production-build page.\n\n```bash\ndocker compose up -d\n```',
        status: 'verified',
      }),
    })
    return response.ok
  })
  expect(created).toBe(true)

  await page.goto('/_search')
  await page.getByRole('combobox', { name: 'Search the wiki' }).fill('Browser smoke')
  await expect(page.getByText('E2E Release Page')).toBeVisible()

  const appearanceUpdated = await page.evaluate(async () => {
    const token = localStorage.getItem('token')
    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ themePreset: 'minimal' }),
    })
    return response.ok
  })
  expect(appearanceUpdated).toBe(true)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e-release-page')
  await expect.poll(() => page.locator('html').getAttribute('data-theme-preset')).toBe('minimal')

  const codeColours = await page.locator('.prose pre').evaluate((pre) => {
    const code = pre.querySelector('code')!
    return {
      background: getComputedStyle(pre).backgroundColor,
      foreground: getComputedStyle(code).color,
    }
  })
  expect(codeColours).toEqual({ background: 'rgb(244, 244, 242)', foreground: 'rgb(32, 33, 36)' })

  const searchCenter = await page.getByRole('textbox', { name: 'Search' }).evaluate((input) => {
    const rect = input.getBoundingClientRect()
    return rect.left + rect.width / 2
  })
  expect(Math.abs(searchCenter - 720)).toBeLessThan(8)
  const headerClearance = await page.locator('.app-shell-header').evaluate((header) => {
    const search = header.querySelector<HTMLInputElement>('.app-header-search input')!.getBoundingClientRect()
    const actions = header.querySelector<HTMLElement>('.app-header-actions')!.getBoundingClientRect()
    return actions.left - search.right
  })
  expect(headerClearance).toBeGreaterThanOrEqual(12)

  const activeRowSpacing = await page.locator('.page-tree-row-active').first().evaluate((row) => {
    const icon = row.querySelector('svg')?.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    return icon ? icon.left - rect.left : 0
  })
  expect(activeRowSpacing).toBeGreaterThanOrEqual(7)
  await expect(page.locator('aside a[href="/_new"]')).toContainText('New page')
  await expect(page.locator('aside a[href="/_new"]')).not.toContainText('+ +')

  const graphButton = page.getByRole('button', { name: 'Show graph' })
  await expect(graphButton).toBeVisible()
  await expect(page.locator('.interactive-graph')).toHaveCount(0)
  await graphButton.click()
  await expect(page.locator('.interactive-graph:visible')).toBeVisible()
  const visibleGraphHeight = await page.locator('.interactive-graph-canvas').evaluateAll((graphs) =>
    graphs.map((graph) => graph.getBoundingClientRect().height).find((height) => height > 0) ?? 0,
  )
  expect(visibleGraphHeight).toBeLessThanOrEqual(240)
  await page.reload()
  await expect(page.locator('.interactive-graph')).toHaveCount(0)

  const more = page.getByText('More actions', { exact: true })
  await more.click()
  const moreDetails = more.locator('xpath=ancestor::details')
  await expect(moreDetails).toHaveAttribute('open', '')
  await page.getByRole('heading', { name: 'E2E Release Page' }).click()
  await expect(moreDetails).not.toHaveAttribute('open', '')

  await expect(page.locator('.app-shell-header')).toHaveScreenshot('centered-header.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  })
  await expect(page.locator('.prose').first()).toHaveScreenshot('minimal-prose.png', { animations: 'disabled' })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/home')
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search pages and commands' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  await page.goto('/_admin')
  await expect(page.getByPlaceholder('Search settings')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByPlaceholder('Search settings').fill('git')
  await expect(page.getByRole('link', { name: 'Git', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pages', exact: true })).toBeHidden()

  await page.goto('/_edit/e2e-release-page')
  await page.getByRole('button', { name: 'Page settings' }).click()
  await page.getByRole('button', { name: 'Archive' }).click()
  const confirmDialog = page.getByRole('dialog', { name: 'Confirm action' })
  await expect(confirmDialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(confirmDialog.getByRole('button', { name: 'Archive' })).toBeVisible()
  await confirmDialog.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Back to editor' }).click()
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible()

  await page.evaluate(() => localStorage.removeItem('token'))
  await page.goto('/_login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByLabel('6-digit authentication code or backup code')).toHaveCount(0)
})
