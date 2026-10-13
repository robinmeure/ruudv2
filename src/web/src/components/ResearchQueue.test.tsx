import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { makeSlide } from '../test/fixtures'
import { ResearchQueue } from './ResearchQueue'

vi.stubGlobal('matchMedia', () => ({
  matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
}))

const running = { slideNumber: 1, jobId: 'batch', status: 'Running' as const, cancellationRequested: false }
const waiting = { slideNumber: 3, jobId: 'batch', status: 'Queued' as const, cancellationRequested: false }
const props = () => ({
  deckId: 'deck', slides: [makeSlide(1), makeSlide(2), makeSlide(3)],
  queue: { maxConcurrency: 4, items: [running, waiting, { ...waiting, slideNumber: 2 }] },
  loading: false, error: null, cancellingSlide: null, cancellingAll: false,
  onCancel: vi.fn(), onCancelAll: vi.fn(), onRetry: vi.fn(),
})

it('separates running and waiting in server order and targets only the chosen job and slide', async () => {
  const p = props()
  render(<ResearchQueue {...p} />)
  expect(screen.getByText('Up to 4 slides in parallel, shared across all decks.')).toBeTruthy()
  const queue = within(screen.getByRole('region', { name: 'Queued slides' }))
  expect(queue.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
    '#/decks/deck/slides/3', '#/decks/deck/slides/2',
  ])
  await userEvent.click(screen.getByRole('button', { name: 'Remove slide 3 from queue' }))
  expect(p.onCancel).toHaveBeenCalledWith(waiting)
  await userEvent.click(screen.getByRole('button', { name: 'Stop research for slide 1' }))
  expect(p.onCancel).toHaveBeenLastCalledWith(running)
  await userEvent.click(screen.getByRole('button', { name: 'Hide queue' }))
  expect(screen.queryByRole('region', { name: 'Queued slides' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Stop all (3)' }))
  expect(p.onCancelAll).toHaveBeenCalledOnce()
})

it('shows pending removal, acknowledged stopping, and recoverable queue failures', async () => {
  const p = props()
  const { rerender } = render(<ResearchQueue {...p} cancellingSlide={3} />)
  expect(screen.getByRole('button', { name: 'Remove slide 3 from queue' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('Removing…')).toBeTruthy()
  rerender(<ResearchQueue {...p} queue={{ ...p.queue, items: [{ ...running, cancellationRequested: true }, waiting] }} />)
  expect(screen.getByRole('button', { name: 'Stop research for slide 1' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('Stopping…')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Remove slide 3 from queue' }).hasAttribute('disabled')).toBe(false)
  rerender(<ResearchQueue {...p} error="Service unavailable" />)
  expect(screen.getByRole('alert').textContent).toContain('Service unavailable')
  await userEvent.click(screen.getByRole('button', { name: 'Retry queue' }))
  expect(p.onRetry).toHaveBeenCalledOnce()
})

it('does not invent active work and exposes initial loading', () => {
  const p = props()
  const { rerender } = render(<ResearchQueue {...p} queue={undefined} loading />)
  expect(screen.getByRole('status').textContent).toContain('Loading research queue')
  rerender(<ResearchQueue {...p} queue={{ maxConcurrency: 4, items: [] }} />)
  expect(screen.queryByRole('region', { name: 'Research queue' })).toBeNull()
})
