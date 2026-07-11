import { expect, test } from '@playwright/test'

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
        content: '# Browser smoke\n\nA searchable production-build page.',
        status: 'verified',
      }),
    })
    return response.ok
  })
  expect(created).toBe(true)

  await page.goto('/_search')
  await page.getByRole('combobox', { name: 'Search the wiki' }).fill('Browser smoke')
  await expect(page.getByText('E2E Release Page')).toBeVisible()
})
