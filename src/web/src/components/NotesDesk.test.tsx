import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { runGuarded } from '../hooks/useRoute'
import { makeProposal, makeSlide } from '../test/fixtures'
import { NotesDesk } from './NotesDesk'

it('preserves dirty edits across activity and proposal updates', async () => {
  const user = userEvent.setup()
  const slide = makeSlide(2, { proposal: makeProposal(), review: 'Pending' })
  const onReview = vi.fn()
  const { rerender } = render(<NotesDesk slide={slide} reviewing={false} onReview={onReview} />)
  await user.clear(screen.getByRole('textbox'))
  await user.type(screen.getByRole('textbox'), 'My unsaved draft')
  rerender(<NotesDesk slide={{ ...slide, activity: ['10:00:00 More activity'] }} reviewing={false} onReview={onReview} />)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My unsaved draft')
  rerender(<NotesDesk slide={{ ...slide, proposal: { ...makeProposal(), createdAt: '2026-10-02T10:00:00Z' } }} reviewing={false} onReview={onReview} />)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My unsaved draft')
  expect(screen.getByText(/saved proposal or decision changed/)).toBeTruthy()
})

it('retains the draft after failed acceptance and permits an explicit retry', async () => {
  const user = userEvent.setup()
  const slide = makeSlide(2, { proposal: makeProposal(), review: 'Pending' })
  const onReview = vi.fn().mockRejectedValueOnce(new Error('Cannot save right now')).mockResolvedValue(slide)
  render(<NotesDesk slide={slide} reviewing={false} onReview={onReview} />)
  await user.clear(screen.getByRole('textbox'))
  await user.type(screen.getByRole('textbox'), 'Keep this text')
  await user.click(screen.getByRole('button', { name: 'Accept notes' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Cannot save right now'))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep this text')
  await user.click(screen.getByRole('button', { name: 'Accept notes' }))
  expect(onReview).toHaveBeenCalledTimes(2)
  expect(onReview).toHaveBeenLastCalledWith('accepted', 'English Version\nKeep this text\n\nDutch Version\nLeg het migratieplan uit en bevestig de vereisten.')
})

it('edits one language at a time and keeps the other intact', async () => {
  const user = userEvent.setup()
  const slide = makeSlide(2, { proposal: makeProposal(), review: 'Pending' })
  const onReview = vi.fn().mockResolvedValue(slide)
  render(<NotesDesk slide={slide} reviewing={false} onReview={onReview} />)
  expect((screen.getByRole('textbox', { name: 'Proposed notes, English' }) as HTMLTextAreaElement).value).toBe('Explain the migration plan and confirm the prerequisites.')
  await user.click(screen.getByRole('button', { name: 'Dutch' }))
  const dutch = screen.getByRole('textbox', { name: 'Proposed notes, Dutch' }) as HTMLTextAreaElement
  expect(dutch.lang).toBe('nl')
  await user.clear(dutch)
  expect((screen.getByRole('button', { name: 'Accept notes' }) as HTMLButtonElement).disabled).toBe(true)
  await user.type(dutch, 'Nieuwe tekst ')
  await user.click(screen.getByRole('button', { name: 'Accept notes' }))
  expect(onReview).toHaveBeenLastCalledWith('accepted', 'English Version\nExplain the migration plan and confirm the prerequisites.\n\nDutch Version\nNieuwe tekst ')
})

it('blocks duplicate decisions while the request is pending', async () => {
  const slide = makeSlide(2, { proposal: makeProposal(), review: 'Pending' })
  let resolve!: (value: typeof slide) => void
  const onReview = vi.fn(() => new Promise<typeof slide>((done) => { resolve = done }))
  render(<NotesDesk slide={slide} reviewing={false} onReview={onReview} />)
  await userEvent.dblClick(screen.getByRole('button', { name: 'Accept notes' }))
  expect(onReview).toHaveBeenCalledOnce()
  expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => resolve(slide))
})

it('keeps navigation blocked after a failed save, and only offers save for valid drafts', async () => {
  const user = userEvent.setup()
  const slide = makeSlide(2, { proposal: makeProposal(), review: 'Pending' })
  const onReview = vi.fn().mockRejectedValue(new Error('Server unavailable'))
  const proceed = vi.fn()
  render(<NotesDesk slide={slide} reviewing={false} onReview={onReview} />)
  await user.clear(screen.getByRole('textbox'))
  act(() => runGuarded(proceed, true))
  expect(screen.queryByRole('button', { name: 'Accept and continue' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Stay' }))
  await user.type(screen.getByRole('textbox'), 'Valid local draft')
  act(() => runGuarded(proceed, true))
  await user.click(screen.getByRole('button', { name: 'Accept and continue' }))
  await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('Server unavailable'))
  expect(proceed).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Discard and continue' }))
  expect(proceed).toHaveBeenCalledOnce()
})

it('uses original text for manual notes and keeps the word budget advisory', async () => {
  const user = userEvent.setup()
  const slide = makeSlide(3)
  const onReview = vi.fn().mockResolvedValue(slide)
  render(<NotesDesk slide={slide} reviewing={false} onReview={onReview} />)
  await user.click(screen.getByRole('button', { name: 'Write notes yourself' }))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(slide.content.notes)
  await user.clear(screen.getByRole('textbox'))
  await user.paste('word '.repeat(300))
  expect(screen.getByText(/Longer notes can still be accepted/)).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Accept notes' }) as HTMLButtonElement).disabled).toBe(false)
})

it('shows real word diffs and keeps proposal warnings with the editor, never behind details', async () => {
  const slide = makeSlide(2, { proposal: makeProposal(), review: 'Pending' })
  render(<NotesDesk slide={slide} reviewing={false} onReview={vi.fn()} />)
  expect(screen.getByText('Confirm release status before presenting.').closest('details')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Changes' }))
  const diff = screen.getByLabelText('Changes against original notes')
  expect(diff.querySelector('ins')).toBeTruthy()
  expect(diff.querySelector('del')).toBeTruthy()
  expect(screen.queryByText('Confirm release status before presenting.')).toBeNull()
  expect(screen.getByText(/Review the warnings on the Proposed notes tab/)).toBeTruthy()
})
