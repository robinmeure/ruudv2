import { describe, expect, it } from 'vitest'
import { makeSlide } from '../test/fixtures'
import { contentPreview, sectionGroups, toggleVisibleSelection, visibleSlides } from './storyboard'
import { bayCounts, slideTitle } from './strip'

describe('storyboard state', () => {
  it('combines number, title and section search with the existing workflow filter in deck order', () => {
    const slides = [makeSlide(1), makeSlide(2, { review: 'Pending' }), makeSlide(3, { review: 'Pending' })]
    slides[1].content.title = 'Migratie aanpak'
    slides[1].content.section = 'Europa'
    expect(visibleSlides(slides, 'review', ' EUROPA 2 migratie ')).toEqual([slides[1]])
    expect(visibleSlides(slides, 'attention', 'Europa')).toEqual([])
    expect(visibleSlides(slides, 'all', '')).toEqual(slides)
  })

  it('keeps separate occurrences of a section in their original order', () => {
    const slides = [makeSlide(3), makeSlide(1), makeSlide(2)]
    slides[1].content.section = 'Other'
    expect(sectionGroups(slides).map((g) => g.slides.map((s) => s.content.number))).toEqual([[3], [1], [2]])
  })

  it('selects and deselects only visible results without losing hidden selections', () => {
    const visible = [makeSlide(2), makeSlide(3)]
    const selection = toggleVisibleSelection(new Set([1, 2]), visible)
    expect([...selection]).toEqual([1, 2, 3])
    expect([...toggleVisibleSelection(selection, visible)]).toEqual([1])
    expect([...toggleVisibleSelection(selection, [])]).toEqual([1, 2, 3])
  })

  it('does not count uploaded notes health as an exclusive workflow partition', () => {
    const slides = [makeSlide(1), makeSlide(2, { review: 'Pending' }), makeSlide(3, { review: 'Accepted' }), makeSlide(4, { status: 'Running' })]
    expect(slides.filter((s) => s.assessment.flagged)).toHaveLength(4)
    expect(bayCounts(slides)).toEqual({ all: 4, attention: 1, research: 1, review: 1, cleared: 1 })
  })
})

describe('content preview fallbacks', () => {
  it('never describes an image-only or chart-only slide as empty', () => {
    const slide = makeSlide(1)
    slide.content.title = null
    slide.content.paragraphs = []
    slide.content.pictureCount = 2
    expect(slideTitle(slide)).toBe('Untitled image slide')
    expect(contentPreview(slide)).toBe('2 images. No body text extracted.')
    slide.content.pictureCount = 0
    slide.content.chartCount = 1
    expect(slideTitle(slide)).toBe('Untitled chart slide')
    expect(contentPreview(slide)).toContain('1 chart.')
  })

  it('uses real extracted text and supplies an untitled fallback', () => {
    const slide = makeSlide(1)
    slide.content.title = null
    expect(slideTitle(slide)).toBe(slide.content.paragraphs[0].text)
    expect(contentPreview(slide)).toBe(slide.content.paragraphs[0].text)
    slide.content.paragraphs = []
    expect(slideTitle(slide)).toBe('Untitled slide')
    expect(contentPreview(slide)).toContain('No body text extracted.')
  })
})
