import { expect, test } from '@playwright/test'
import { makeProposal } from '../src/test/fixtures'
import { emitQueue, emitSlide, mockApi } from './mockApi'

const url = '/#/decks/fixture-deck/slides/2'

test('queue actions preserve a dirty review, isolate batch siblings, and show real stopping state', async ({ page }) => {
  const api = await mockApi(page)
  for (const number of [3, 4]) Object.assign(api.deck.slides[number - 1], { status: 'Queued', jobId: 'shared-batch' })
  api.deck.slides[4].jobId = 'shared-batch'
  api.queueOrder = [5, 4, 3]
  await page.goto(url)
  const queue = page.getByRole('region', { name: 'Research queue', exact: true })
  const waiting = queue.getByRole('region', { name: 'Queued slides' })
  await expect(queue).toContainText('1 running · 2 queued')
  await expect(waiting.getByRole('link').first()).toHaveAttribute('href', /slides\/4$/)
  const editor = page.getByRole('textbox', { name: 'Proposed notes' })
  await editor.fill('Keep my unsaved review while I manage research')
  await waiting.getByRole('link').first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stay', exact: true }).click()

  let release!: () => void
  api.cancelGate = new Promise<void>((resolve) => { release = resolve })
  await queue.getByRole('button', { name: 'Remove slide 4 from queue' }).dblclick()
  await expect(queue.getByRole('button', { name: 'Remove slide 4 from queue' })).toBeDisabled()
  await expect(queue.getByText('Removing…')).toBeVisible()
  expect(api.slideCancellations).toEqual([{ number: 4, jobId: 'shared-batch' }])
  release()
  await expect(queue.getByRole('button', { name: 'Remove slide 4 from queue' })).toHaveCount(0)
  expect(api.deck.slides[2].status).toBe('Queued')
  expect(api.deck.slides[4].status).toBe('Running')
  await queue.getByRole('button', { name: 'Stop research for slide 5' }).click()
  await expect(queue.getByRole('button', { name: 'Stop research for slide 5' })).toBeDisabled()
  await expect(queue.getByText('Stopping…')).toBeVisible()
  expect(api.deck.slides[2].status).toBe('Queued')
  await expect(editor).toHaveValue('Keep my unsaved review while I manage research')
  Object.assign(api.deck.slides[4], { status: 'Cancelled', jobId: null, cancellationRequested: false })
  await emitSlide(page, api.deck.slides[4])
  await expect(queue).toContainText('0 running · 1 queued')
  Object.assign(api.deck.slides[2], { status: 'Running' })
  await emitSlide(page, api.deck.slides[2])
  await expect(queue.getByRole('button', { name: 'Stop research for slide 3' })).toBeVisible()
  Object.assign(api.deck.slides[2], { status: 'Succeeded', jobId: null, proposal: makeProposal(), review: 'Pending' })
  await emitSlide(page, api.deck.slides[2])
  await expect(queue).toHaveCount(0)
  await expect(editor).toHaveValue('Keep my unsaved review while I manage research')
})

test('failed cancellation retains the queue entry and retry recovers a failed queue read', async ({ page }) => {
  const api = await mockApi(page)
  Object.assign(api.deck.slides[2], { status: 'Queued', jobId: 'batch' })
  await page.goto(url)
  api.failCancel = true
  await page.getByRole('button', { name: 'Remove slide 3 from queue' }).click()
  await expect(page.getByText('Cancellation failed. Try again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove slide 3 from queue' })).toBeEnabled()
  expect(api.deck.slides[2].status).toBe('Queued')
  api.failQueue = true
  await emitQueue(page)
  await expect(page.getByRole('button', { name: 'Retry queue' })).toBeVisible()
  api.failQueue = false
  await page.getByRole('button', { name: 'Retry queue' }).click()
  await expect(page.getByRole('button', { name: 'Retry queue' })).toHaveCount(0)
  api.failCancel = false
  await page.getByRole('button', { name: 'Remove slide 3 from queue' }).click()
  await expect(page.getByRole('button', { name: 'Remove slide 3 from queue' })).toHaveCount(0)
})

test('review-panel stopping targets only its slide, including on mobile', async ({ page }) => {
  const api = await mockApi(page)
  Object.assign(api.deck.slides[2], { status: 'Queued', jobId: 'job-5' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/decks/fixture-deck/slides/5')
  await page.getByRole('button', { name: 'Stop this slide', exact: true }).click()
  expect(api.slideCancellations).toEqual([{ number: 5, jobId: 'job-5' }])
  expect(api.deck.slides[2].status).toBe('Queued')
  await expect(page.getByRole('region', { name: 'Review slide 5', exact: true }).getByRole('button', { name: 'Stopping…' })).toBeDisabled()
  await page.getByRole('button', { name: 'Remove slide 3 from queue' }).click()
  await expect(page.getByRole('button', { name: 'Remove slide 3 from queue' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('queue stays bounded with long titles and many slides at desktop and mobile widths', async ({ page }) => {
  const api = await mockApi(page)
  for (const slide of api.deck.slides) Object.assign(slide, { status: slide.content.number <= 4 ? 'Running' : 'Queued', jobId: 'large-batch' })
  await page.goto(url)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const queue = page.getByRole('region', { name: 'Research queue', exact: true })
    await expect(queue).toContainText('4 running · 74 queued')
    expect(await queue.evaluate((element) => element.getBoundingClientRect().height <= innerHeight * 0.38 + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('region', { name: 'Review slide 2', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/queue-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Hide queue' }).click()
    await expect(queue.getByRole('region', { name: 'Queued slides' })).toBeHidden()
    await page.getByRole('button', { name: 'Show queue' }).click()
  }
  await page.setViewportSize({ width: 720, height: 450 })
  const showQueue = page.getByRole('button', { name: 'Show queue' })
  await expect(showQueue).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: 'Queued slides' })).toBeHidden()
  await showQueue.click()
  await expect(page.getByRole('button', { name: 'Hide queue' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Remove slide 5 from queue' })).toBeVisible()
  await page.getByRole('button', { name: 'Hide queue' }).click()
})
