import type { Page } from '@playwright/test'
import type { DeckEvent, ReviewDecision, SlideState } from '../src/api/types'
import { makeDeck } from '../src/test/fixtures'

export async function mockApi(page: Page) {
  const control = {
    deck: makeDeck(),
    offline: false,
    missing: false,
    loadError: false,
    failReview: false,
    failExport: false,
    failQueue: false,
    failCancel: false,
    cancelGate: null as Promise<void> | null,
    queueOrder: [] as number[],
    slideCancellations: [] as { number: number; jobId: string }[],
    reviewGate: null as Promise<void> | null,
    reviews: [] as { number: number; status: ReviewDecision; notes: string | null }[],
    research: [] as number[][],
    cancellations: [] as string[],
    reads: 0,
  }

  await page.addInitScript(() => {
    class FakeEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      onerror: (() => void) | null = null
      private message = (event: Event) => {
        if (event instanceof CustomEvent) this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event.detail) }))
      }
      private error = () => this.onerror?.()
      constructor() {
        window.addEventListener('test-deck-event', this.message)
        window.addEventListener('test-deck-disconnect', this.error)
        setTimeout(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'connected' }) })), 0)
      }
      close() {
        window.removeEventListener('test-deck-event', this.message)
        window.removeEventListener('test-deck-disconnect', this.error)
      }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeEventSource })
  })

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/copilot/status') {
      await route.fulfill({ json: {
        connected: !control.offline, authenticated: !control.offline, cliUrl: 'fixture-only',
        version: 'test', login: 'test-presenter', authType: 'test', statusMessage: null,
        configuredModel: null, models: [{ id: 'fixture-model', name: 'Fixture model', multiplier: null }], error: null,
      } })
      return
    }
    if (path === '/api/decks') {
      const deck = control.deck
      await route.fulfill({ json: [{ ...deck, slideCount: deck.slides.length,
        flaggedCount: deck.slides.filter((s) => s.assessment.flagged).length,
        proposalCount: deck.slides.filter((s) => s.review === 'Pending').length,
        acceptedCount: deck.slides.filter((s) => s.review === 'Accepted').length }] })
      return
    }
    if (path === '/api/decks/fixture-deck') {
      control.reads++
      if (control.missing) await route.fulfill({ status: 404, json: { title: 'Deck not found' } })
      else if (control.loadError) await route.fulfill({ status: 503, json: { title: 'Deck temporarily unavailable' } })
      else await route.fulfill({ json: control.deck })
      return
    }
    if (path === '/api/decks/fixture-deck/queue') {
      if (control.failQueue) {
        await route.fulfill({ status: 503, json: { title: 'Queue is temporarily unavailable.' } })
        return
      }
      const ordered = [...control.queueOrder, ...control.deck.slides.map((s) => s.content.number).filter((n) => !control.queueOrder.includes(n))]
      await route.fulfill({ json: { maxConcurrency: 4, items: ordered.flatMap((number) => {
        const slide = control.deck.slides[number - 1]
        return slide && slide.jobId && (slide.status === 'Queued' || slide.status === 'Running') ? [{
          slideNumber: number, jobId: slide.jobId, status: slide.status, cancellationRequested: slide.cancellationRequested,
        }] : []
      }) } })
      return
    }
    const review = /\/slides\/(\d+)\/review$/.exec(path)
    if (review) {
      const number = Number(review[1])
      const body = request.postDataJSON() as { status: ReviewDecision; notes: string | null }
      control.reviews.push({ number, ...body })
      await control.reviewGate
      if (control.failReview) {
        await route.fulfill({ status: 503, json: { title: 'The review could not be saved.' } })
        return
      }
      const current = control.deck.slides[number - 1]
      const slide: SlideState = {
        ...current,
        review: body.status === 'accepted' ? 'Accepted' : body.status === 'rejected' ? 'Rejected' : current.proposal ? 'Pending' : 'None',
        acceptedNotes: body.status === 'accepted' ? body.notes : null,
      }
      control.deck.slides[number - 1] = slide
      await route.fulfill({ json: slide })
      return
    }
    if (path.endsWith('/enrich')) {
      const body = request.postDataJSON() as { slides: number[] | null }
      const single = /\/slides\/(\d+)\/enrich$/.exec(path)
      const numbers = single ? [Number(single[1])] : body.slides ?? []
      control.research.push(numbers)
      const jobId = `fixture-job-${control.research.length}`
      const claimed: number[] = []
      for (const number of numbers) {
        const current = control.deck.slides[number - 1]
        if (current.status === 'Queued' || current.status === 'Running') continue
        control.deck.slides[number - 1] = { ...current, status: 'Queued', jobId, cancellationRequested: false, error: null, activity: [] }
        control.queueOrder = control.queueOrder.filter((n) => n !== number)
        control.queueOrder.push(number)
        claimed.push(number)
      }
      await route.fulfill({ json: { jobId, deckId: control.deck.id, slides: claimed } })
      return
    }
    if (path.endsWith('/cancel')) {
      control.cancellations.push(path)
      const single = /\/slides\/(\d+)\/cancel$/.exec(path)
      if (single) {
        const number = Number(single[1])
        const body = request.postDataJSON() as { jobId: string }
        control.slideCancellations.push({ number, ...body })
        await control.cancelGate
        if (control.failCancel) {
          await route.fulfill({ status: 503, json: { title: 'Cancellation failed. Try again.' } })
          return
        }
        const slide = control.deck.slides[number - 1]
        if (slide.jobId !== body.jobId || (slide.status !== 'Queued' && slide.status !== 'Running')) {
          await route.fulfill({ status: 409, json: 'This research run is no longer active. Refresh the queue.' })
          return
        }
        if (slide.status === 'Queued') { slide.status = 'Cancelled'; slide.jobId = null; slide.cancellationRequested = false }
        else slide.cancellationRequested = true
        await route.fulfill({ json: slide })
        return
      }
      const job = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(path)
      for (const slide of control.deck.slides) {
        if ((!job || slide.jobId === job[1]) && (slide.status === 'Queued' || slide.status === 'Running')) {
          slide.status = 'Cancelled'; slide.jobId = null; slide.cancellationRequested = false
        }
      }
      await route.fulfill({ status: 204 })
      return
    }
    if (path.endsWith('/export')) {
      if (control.failExport) {
        await route.fulfill({ status: 503, json: { title: 'Export could not be prepared. Try again.' } })
        return
      }
      await route.fulfill({
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        headers: { 'Content-Disposition': 'attachment; filename=storyboard-fixture-enriched.pptx' },
        body: Buffer.from('Export route fixture; actual package preservation is covered by API tests.'),
      })
      return
    }
    await route.fulfill({ status: 500, json: { title: `Unexpected test request: ${request.method()} ${path}` } })
  })
  return control
}

export async function emitSlide(page: Page, slide: SlideState) {
  const event: DeckEvent = {
    type: 'slide-status', deckId: 'fixture-deck', slideNumber: slide.content.number,
    jobId: slide.jobId, status: slide.status, message: null, slide, timestamp: '2026-10-01T10:10:00Z',
  }
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent('test-deck-event', { detail })), event)
  await emitQueue(page)
}

export async function emitQueue(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-deck-event', { detail: { type: 'queue', deckId: 'fixture-deck' } })))
}
