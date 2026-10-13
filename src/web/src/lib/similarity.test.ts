import { describe, expect, it } from 'vitest'
import { makeSlide } from '../test/fixtures'
import { analyzeDeck, boilerplateLines, clusterSlides, cosine, deckTexts, findMatches, topicLabel, normalizeText, relatedCutoff, scorePosition, textsToEmbed, wordOverlap } from './similarity'

function slideWith(number: number, title: string, body: string, notes = '') {
  const slide = makeSlide(number)
  slide.content.title = title
  slide.content.paragraphs = [{ text: body, level: 0 }, { text: 'Microsoft Confidential', level: 0 }]
  slide.content.notes = notes
  return slide
}

const unit = (...values: number[]) => {
  const length = Math.hypot(...values)
  return new Float32Array(values.map((v) => v / length))
}

describe('slide similarity', () => {
  const slides = [
    slideWith(1, 'Landing zone design', 'Plan subscriptions, policies and network topology', 'Explain the landing zone.'),
    slideWith(2, 'Landing zone design', 'Plan subscriptions, policies and network topology', 'Different talk track.'),
    slideWith(3, 'Landing zone architecture', 'Design subscriptions, governance policies and hub network', 'Explain the landing zone.'),
    slideWith(4, 'Pricing overview', 'Compare reserved instances with savings plans for compute', ''),
    slideWith(5, 'Questions?', '', ''),
  ]
  const texts = deckTexts(slides)
  const vectors = new Map<string, Float32Array>([
    [texts[0].visible, unit(1, 0, 0)],
    [texts[2].visible, unit(1, 0.4, 0)],
    [texts[3].visible, unit(0, 0, 1)],
    ['Explain the landing zone.', unit(0, 1, 0)],
    ['Different talk track.', unit(1, 0, 0)],
  ])
  const lookup = (text: string) => vectors.get(text)

  it('normalizes case, punctuation and width', () => {
    expect(normalizeText('  Azure  Arc — Overview! ')).toBe('azure arc overview')
  })

  it('treats lines repeated across the deck as template text', () => {
    expect(boilerplateLines(slides)).toEqual(new Set(['microsoft confidential']))
    expect(texts[0].visible).not.toContain('Confidential')
  })

  it('uses accepted notes instead of the original notes', () => {
    const accepted = { ...slides[0], acceptedNotes: 'Accepted notes.' }
    expect(deckTexts([accepted, ...slides.slice(1)])[0].notes).toBe('Accepted notes.')
  })

  it('skips visible text that is too short to embed meaningfully', () => {
    expect(textsToEmbed(texts)).not.toContain(texts[4].visible)
    expect(textsToEmbed(texts)).toContain(texts[0].visible)
  })

  it('measures cosine and word overlap', () => {
    expect(cosine(unit(1, 0), unit(1, 0))).toBeCloseTo(1)
    expect(wordOverlap(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3)
  })

  it('ranks identical text first, then related slides, and leaves unrelated slides out', () => {
    const matches = findMatches(1, texts, lookup)
    expect(matches.map((m) => [m.number, m.kind])).toEqual([[2, 'identical'], [3, 'related']])
    expect(matches[1].contentScore).toBeCloseTo(cosine(unit(1, 0, 0), unit(1, 0.4, 0)))
    expect(matches[1].notesScore).toBeCloseTo(1)
  })

  it('reports only identical text for low-content slides', () => {
    const copy = slideWith(6, 'Questions?', '', '')
    const lowTexts = deckTexts([...slides, copy])
    expect(findMatches(5, lowTexts, lookup).map((m) => [m.number, m.kind])).toEqual([[6, 'identical']])
  })

  it('needs shared wording before a very high cosine counts as a duplicate', () => {
    const nearly = new Map(vectors)
    nearly.set(texts[2].visible, unit(1, 0.05, 0))
    const match = findMatches(1, texts, (text) => nearly.get(text)).find((m) => m.number === 3)
    expect(match?.contentScore).toBeGreaterThan(0.99)
    expect(match?.kind).toBe('related')
  })

  it('flags a lightly edited copy as a likely duplicate through shared words', () => {
    const edited = slideWith(6, 'Landing zone design', 'Plan subscriptions, policies and the network topology', '')
    const editedTexts = deckTexts([...slides, edited])
    const match = findMatches(1, editedTexts, lookup).find((m) => m.number === 6)
    expect(match?.kind).toBe('near-duplicate')
  })

  it('raises the related cutoff when a deck is uniformly similar', () => {
    const many = Array.from({ length: 6 }, (_, i) => slideWith(i + 1, `Topic ${i}`, `Distinct words for slide number ${i} here`))
    const manyTexts = deckTexts(many)
    const spread = new Map(manyTexts.map((t, i) => [t.visible, unit(1, 0.25 + i * 0.01, 0)]))
    expect(relatedCutoff(manyTexts, (text) => spread.get(text))).toBeGreaterThan(0.88)
    expect(relatedCutoff(texts, lookup)).toBe(0.88)
  })

  it('groups duplicates, clusters topics and indexes both per slide', () => {
    const titles = new Map(slides.map((s) => [s.content.number, s.content.title ?? '']))
    const analysis = analyzeDeck(texts, lookup, titles)
    expect(analysis.duplicateGroups).toEqual([{ id: 1, slides: [1, 2] }])
    expect(analysis.topics.map((t) => t.slides)).toEqual([[1, 2, 3]])
    expect(analysis.bySlide.get(2)?.duplicateGroup?.slides).toEqual([1, 2])
    expect(analysis.bySlide.get(4)?.topic).toBeNull()
    expect(analysis.bySlide.get(5)?.matches).toEqual([])
  })
})

describe('topic clustering', () => {
  it('places scores between the deck typical and a perfect match', () => {
    expect(scorePosition(0.86, 0.86)).toBe(0)
    expect(scorePosition(0.93, 0.86)).toBeCloseTo(0.5)
    expect(scorePosition(0.5, 0.86)).toBe(0)
    expect(scorePosition(1, 0.86)).toBe(1)
  })
  it('merges by average linkage and stops at the cutoff', () => {
    const items = [
      { number: 1, vector: unit(1, 0, 0) },
      { number: 2, vector: unit(1, 0.1, 0) },
      { number: 3, vector: unit(1, 0.6, 0) },
      { number: 4, vector: unit(0, 0, 1) },
    ]
    expect(clusterSlides(items, 0.9)).toEqual([[1, 2]])
    expect(clusterSlides(items, 0.85)).toEqual([[1, 2, 3]])
  })

  it('labels a topic with the title words it shares and the deck lacks', () => {
    const titles = new Map([
      [1, 'NVv3 retirement in Azure'], [2, 'NVv4 retirement on Azure'], [3, 'Azure pricing'], [4, 'Azure roadmap'],
    ])
    expect(topicLabel([1, 2], titles)).toBe('Retirement')
    expect(topicLabel([3, 4], new Map([[3, 'Azure pricing'], [4, 'Azure roadmap'], [5, 'Security']]))).toBe('Azure')
  })

  it('falls back to the first title when no word is shared', () => {
    expect(topicLabel([3, 4], new Map([[3, 'Pricing'], [4, 'Roadmap']]))).toBe('Pricing')
  })
})
