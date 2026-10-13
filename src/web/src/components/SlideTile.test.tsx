import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { makeSlide } from '../test/fixtures'
import { SlideTile } from './SlideTile'

it('separates navigation, active state, batch selection, and new-proposal state', async () => {
  const onToggle = vi.fn()
  render(<ul><SlideTile deckId="deck" slide={makeSlide(2)} active selected={false} unseen onToggle={onToggle} /></ul>)
  const link = screen.getByRole('link', { name: 'Open slide 2: Slide topic 2' })
  const checkbox = screen.getByRole('checkbox', { name: 'Select slide 2: Slide topic 2' })
  expect(link.getAttribute('aria-current')).toBe('page')
  expect(within(link).queryByRole('checkbox')).toBeNull()
  expect(screen.getByText('New proposal')).toBeTruthy()
  expect(screen.getByText('Content preview · extracted text')).toBeTruthy()
  await userEvent.click(checkbox)
  expect(onToggle).toHaveBeenCalledOnce()
})

it('exposes hidden and structural indicators without inferring an empty slide', () => {
  const slide = makeSlide(3)
  slide.content.hidden = true
  slide.content.title = null
  slide.content.paragraphs = []
  slide.content.pictureCount = 1
  slide.assessment.suggestSkip = true
  render(<ul><SlideTile deckId="deck" slide={slide} active={false} selected unseen={false} onToggle={vi.fn()} /></ul>)
  expect(screen.getByRole('link', { name: 'Open slide 3: Untitled image slide' })).toBeTruthy()
  expect(screen.getByText('Hidden')).toBeTruthy()
  expect(screen.getByText('Content · suggested skip')).toBeTruthy()
  expect(screen.getByText('1 image. No body text extracted.')).toBeTruthy()
})
