import type { NotesStatus, SlideKind, SlideState } from '../api/types'

/** Existing research/review classification, independent of uploaded notes health. */
export type Bay = 'attention' | 'research' | 'review' | 'cleared' | 'ok'

export type BayFilter = 'all' | Exclude<Bay, 'ok'>

export const bayLabels: Record<BayFilter, string> = {
  all: 'All',
  attention: 'Needs notes',
  research: 'In research',
  review: 'To review',
  cleared: 'Accepted',
}

export const kindLabels: Record<SlideKind, string> = {
  Title: 'Title',
  Section: 'Section',
  Agenda: 'Agenda',
  Legal: 'Legal',
  Closing: 'Closing',
  Content: 'Content',
}

export const notesLabels: Record<NotesStatus, string> = {
  Missing: 'None',
  PlaceholderOnly: 'Placeholder',
  Thin: 'Thin',
  Ok: 'OK',
}

export function isWorking(slide: SlideState): boolean {
  return slide.status === 'Queued' || slide.status === 'Running'
}

export function bayOf(slide: SlideState): Bay {
  if (isWorking(slide)) return 'research'
  if (slide.review === 'Accepted') return 'cleared'
  if (slide.review === 'Pending') return 'review'
  if (slide.assessment.flagged || slide.status === 'Failed') return 'attention'
  return 'ok'
}

export function matchesBay(slide: SlideState, filter: BayFilter): boolean {
  return filter === 'all' || bayOf(slide) === filter
}

export function bayCounts(slides: SlideState[]): Record<BayFilter, number> {
  const counts: Record<BayFilter, number> = { all: slides.length, attention: 0, research: 0, review: 0, cleared: 0 }
  for (const slide of slides) {
    const bay = bayOf(slide)
    if (bay !== 'ok') counts[bay] += 1
  }
  return counts
}

/** Slides the server picks for "enrich flagged": flagged, no proposal yet, not accepted, not already in research. */
export function enrichableFlagged(slides: SlideState[]): SlideState[] {
  return slides.filter(
    (s) => s.assessment.flagged && s.proposal === null && s.review !== 'Accepted' && !isWorking(s),
  )
}

export function slideTitle(slide: SlideState): string {
  const title = slide.content.title?.trim()
  if (title) return title
  const firstText = slide.content.paragraphs.find((p) => p.text.trim().length > 0)?.text.trim()
  if (firstText) return firstText
  if (slide.content.chartCount > 0) return slide.content.chartTitles[0]?.trim() || 'Untitled chart slide'
  if (slide.content.pictureCount > 0) return 'Untitled image slide'
  return 'Untitled slide'
}

export function proposalKey(slide: SlideState): string | null {
  return slide.proposal ? `${slide.content.number}:${slide.proposal.createdAt}` : null
}

export function stateLabel(slide: SlideState): string {
  switch (slide.status) {
    case 'Queued':
      return 'Queued'
    case 'Running':
      return 'Research'
    case 'Failed':
      return 'Failed'
    case 'Cancelled':
      return slide.review === 'Accepted' ? 'Accepted' : 'Cancelled'
    default:
      break
  }
  switch (slide.review) {
    case 'Pending':
      return 'To review'
    case 'Accepted':
      return 'Accepted'
    case 'Rejected':
      return 'Rejected'
    default:
      return 'Not researched'
  }
}

export function exportName(fileName: string): string {
  return `${fileName.replace(/\.pptx$/i, '')}-enriched.pptx`
}

/** Activity lines arrive as "HH:mm:ss message". */
export function splitActivity(line: string): { time: string; text: string } {
  const match = /^(\d{2}:\d{2}:\d{2})\s+(.*)$/.exec(line)
  return match ? { time: match[1], text: match[2] } : { time: '', text: line }
}

export type ActivityKind = 'thinking' | 'plan' | 'result' | 'problem' | 'step'

const activityPrefixes: ReadonlyArray<readonly [string, ActivityKind]> = [
  ['Thinking: ', 'thinking'],
  ['Plan: ', 'plan'],
  ['Result: ', 'result'],
  ['Blocked: ', 'problem'],
  ['Tool failed: ', 'problem'],
  ['Copilot error: ', 'problem'],
]

/** The backend prefixes reasoning, plans and tool results; the panel styles them differently and drops the prefix. */
export function classifyActivity(text: string): { kind: ActivityKind; text: string } {
  for (const [prefix, kind] of activityPrefixes) {
    if (text.startsWith(prefix)) return { kind, text: kind === 'problem' ? text : text.slice(prefix.length) }
  }
  return { kind: 'step', text }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// Same rule as the backend assessor (SlideAssessor.Words), so the desk and the strips report the same count.
const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}\-'’.]*/gu

export function countWords(text: string): number {
  return text.match(wordPattern)?.length ?? 0
}

// Same headings and budget split as the backend (SpeakerNotesRules).
const englishHeading = /^\s*(english version|engelse versie)\s*:?\s*$/i
const dutchHeading = /^\s*(dutch version|nederlandse versie)\s*:?\s*$/i

export function wordBudgetPerLanguage(maxWords: number): number {
  return Math.max(40, Math.floor(maxWords / 2))
}

/** Word counts per language for notes in the "English Version / Dutch Version" layout, or null for other notes. */
export function bilingualWordCounts(text: string): { english: number; dutch: number } | null {
  const lines = text.split(/\r?\n/)
  const english = lines.findIndex((line) => englishHeading.test(line))
  const dutch = lines.findIndex((line) => dutchHeading.test(line))
  if (english < 0 || dutch <= english) return null
  return {
    english: countWords(lines.slice(english + 1, dutch).join(' ')),
    dutch: countWords(lines.slice(dutch + 1).join(' ')),
  }
}

export type NotesLanguage = 'english' | 'dutch'

/** Splits "English Version / Dutch Version" notes so one language can be edited without touching the other. */
export function splitBilingual(text: string): { english: string; dutch: string; compose: (language: NotesLanguage, body: string) => string } | null {
  const lines = text.split(/\r?\n/)
  const english = lines.findIndex((line) => englishHeading.test(line))
  const dutch = lines.findIndex((line) => dutchHeading.test(line))
  if (english < 0 || dutch <= english) return null
  const head = lines.slice(0, english + 1).join('\n')
  const parts = { english: lines.slice(english + 1, dutch).join('\n').replace(/\n$/, ''), dutch: lines.slice(dutch + 1).join('\n') }
  return {
    ...parts,
    // Exact inverse of the split above, so typing at either end of a section round-trips.
    compose: (language, body) => {
      const next = { ...parts, [language]: body }
      return `${head}\n${next.english}\n\n${lines[dutch]}\n${next.dutch}`
    },
  }
}

export function languageLabel(language: string): string {
  if (language === 'en+nl') return 'EN + NL'
  if (language === 'und') return 'language unknown'
  return language.toUpperCase()
}

/** A single BCP 47 tag usable as an HTML lang attribute; bilingual or unknown notes inherit the page language. */
export function singleLanguageTag(language: string | undefined): string | undefined {
  return language && language !== 'und' && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(language) ? language : undefined
}
