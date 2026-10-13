import type { SlideState } from '../api/types'
import type { DeckAnalysis } from './similarity'
import { matchesBay, type BayFilter } from './strip'

export type Grouping = 'section' | 'topic' | 'duplicates'

export const groupingLabels: Record<Grouping, string> = { section: 'Sections', topic: 'Topics', duplicates: 'Duplicates' }

export interface StoryboardGroup {
  key: string
  heading: string
  slides: SlideState[]
}

/** Arranges the visible slides by section, by similarity topic, or only the likely duplicate groups. */
export function storyboardGroups(visible: SlideState[], grouping: Grouping, analysis: DeckAnalysis | null): StoryboardGroup[] {
  if (grouping === 'section' || !analysis) {
    return sectionGroups(visible).map((g) => ({
      key: `section-${g.slides[0].content.number}`,
      heading: g.section || 'Slides without a section',
      slides: g.slides,
    }))
  }
  const byNumber = new Map(visible.map((s) => [s.content.number, s]))
  const pick = (numbers: number[]) => numbers.map((n) => byNumber.get(n)).filter((s): s is SlideState => s !== undefined)

  if (grouping === 'duplicates') {
    return analysis.duplicateGroups
      .map((g) => ({ key: `duplicates-${g.id}`, heading: `Likely duplicates · slides ${g.slides.join(', ')}`, slides: pick(g.slides) }))
      .filter((g) => g.slides.length > 0)
  }

  const groups = analysis.topics
    .map((t) => ({ key: `topic-${t.id}`, heading: `${t.label} · ${t.slides.length} slides`, slides: pick(t.slides) }))
    .filter((g) => g.slides.length > 0)
  const grouped = new Set(analysis.topics.flatMap((t) => t.slides))
  const rest = visible.filter((s) => !grouped.has(s.content.number))
  if (rest.length) groups.push({ key: 'topic-none', heading: 'No close topic match', slides: rest })
  return groups
}

export function visibleSlides(slides: SlideState[], filter: BayFilter, query: string): SlideState[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return slides.filter((slide) => {
    const text = `${slide.content.number} ${slide.content.title ?? ''} ${slide.content.section ?? ''}`.toLocaleLowerCase()
    return matchesBay(slide, filter) && terms.every((term) => text.includes(term))
  })
}

export function sectionGroups(slides: SlideState[]): { section: string | null; slides: SlideState[] }[] {
  const groups: { section: string | null; slides: SlideState[] }[] = []
  for (const slide of slides) {
    const section = slide.content.section?.trim() || null
    const last = groups.at(-1)
    if (last && last.section === section) last.slides.push(slide)
    else groups.push({ section, slides: [slide] })
  }
  return groups
}

export function toggleVisibleSelection(selected: ReadonlySet<number>, visible: SlideState[]): Set<number> {
  const next = new Set(selected)
  const allSelected = visible.length > 0 && visible.every((s) => selected.has(s.content.number))
  for (const slide of visible) {
    if (allSelected) next.delete(slide.content.number)
    else next.add(slide.content.number)
  }
  return next
}

export function contentPreview(slide: SlideState): string {
  const text = slide.content.paragraphs.map((p) => p.text.trim()).filter(Boolean).slice(0, 3).join('\n')
  if (text) return text
  const media = [
    slide.content.pictureCount > 0 && `${slide.content.pictureCount} ${slide.content.pictureCount === 1 ? 'image' : 'images'}`,
    slide.content.chartCount > 0 && `${slide.content.chartCount} ${slide.content.chartCount === 1 ? 'chart' : 'charts'}`,
    slide.content.tables.length > 0 && `${slide.content.tables.length} ${slide.content.tables.length === 1 ? 'table' : 'tables'}`,
  ].filter(Boolean).join(' · ')
  return media ? `${media}. No body text extracted.` : 'No body text extracted. Open the slide to review its notes.'
}
