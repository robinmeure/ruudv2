import type { SlideState } from '../api/types'

export const embeddingModel = 'Xenova/multilingual-e5-small'
export const embeddingModelLabel = 'multilingual-e5-small'
export const embeddingDownloadLabel = 'about 120 MB'

/** Below this many meaningful words, embeddings are unreliable; only identical text is reported. */
export const minSemanticWords = 4

// Provisional thresholds for multilingual-e5-small, checked against a 75-slide deck where unrelated slides
// still scored ~0.86 on average (sd ~0.026) and the closest non-duplicate pairs reached ~0.96.
export const thresholds = {
  /** Shared-word ratio that marks a near copy regardless of the embedding. */
  duplicateWordOverlap: 0.8,
  /** A very high cosine only counts as a duplicate when much of the wording is shared too. */
  duplicateCosine: 0.95,
  duplicateCosineWordOverlap: 0.6,
  /** Related = this many standard deviations above the deck's mean slide-to-slide similarity... */
  relatedZScore: 2,
  /** ...and never below this absolute floor. */
  relatedFloor: 0.88,
  /** Topic groups merge while their average similarity stays this many standard deviations above the deck mean. */
  topicZScore: 1.5,
} as const

export const maxMatches = 5

export type MatchKind = 'identical' | 'near-duplicate' | 'related'

export const matchLabels: Record<MatchKind, string> = {
  identical: 'Identical text',
  'near-duplicate': 'Likely duplicate',
  related: 'Related',
}

export interface SlideTexts {
  number: number
  /** Visible slide text with template lines removed, as fed to the embedding model. */
  visible: string
  notes: string
  normalized: string
  words: Set<string>
}

export interface SlideMatch {
  number: number
  kind: MatchKind
  contentScore: number | null
  notesScore: number | null
  wordOverlap: number
}

export type VectorLookup = (text: string) => Float32Array | undefined

export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function visibleLines(slide: SlideState): string[] {
  const { content } = slide
  return [
    content.title ?? '',
    ...content.paragraphs.map((p) => p.text),
    ...content.tables.flatMap((table) => table.rows.map((row) => row.filter(Boolean).join(' | '))),
    ...content.chartTitles,
    ...content.pictureDescriptions,
  ].filter((line) => normalizeText(line).length > 0)
}

/** Lines that repeat across much of the deck (footers, labels, template text) and would make unrelated slides look alike. */
export function boilerplateLines(slides: SlideState[]): Set<string> {
  const counts = new Map<string, number>()
  for (const slide of slides) {
    for (const line of new Set(visibleLines(slide).map(normalizeText))) counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  const minimum = Math.max(5, Math.ceil(slides.length * 0.4))
  return new Set([...counts].filter(([, count]) => count >= minimum).map(([line]) => line))
}

export function slideTexts(slide: SlideState, boilerplate: Set<string>): SlideTexts {
  const lines = visibleLines(slide).filter((line) => !boilerplate.has(normalizeText(line)))
  const visible = lines.join('\n')
  const normalized = normalizeText(visible)
  return {
    number: slide.content.number,
    visible,
    notes: (slide.acceptedNotes ?? slide.content.notes).trim(),
    normalized,
    words: new Set(normalized ? normalized.split(' ') : []),
  }
}

export function deckTexts(slides: SlideState[]): SlideTexts[] {
  const boilerplate = boilerplateLines(slides)
  return slides.map((slide) => slideTexts(slide, boilerplate))
}

/** Every distinct text the deck needs an embedding for. */
export function textsToEmbed(texts: SlideTexts[]): string[] {
  return [...new Set(texts.flatMap((t) => [t.words.size >= minSemanticWords ? t.visible : '', t.notes]).filter(Boolean))]
}

/** Vectors are normalised by the embedder, so the dot product is the cosine similarity. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

export function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return shared / (a.size + b.size - shared)
}

function score(a: string, b: string, vectorOf: VectorLookup): number | null {
  if (!a || !b) return null
  const va = vectorOf(a)
  const vb = vectorOf(b)
  return va && vb ? cosine(va, vb) : null
}

const kindOrder: Record<MatchKind, number> = { identical: 0, 'near-duplicate': 1, related: 2 }

export interface DeckStats {
  mean: number
  sd: number
}

/** Mean and spread of slide-to-slide similarity; null when too few slides have embeddings. */
export function deckStats(texts: SlideTexts[], vectorOf: VectorLookup): DeckStats | null {
  const vectors = texts
    .filter((t) => t.words.size >= minSemanticWords)
    .map((t) => vectorOf(t.visible))
    .filter((v): v is Float32Array => v !== undefined)
  const scores: number[] = []
  for (let i = 0; i < vectors.length; i++) for (let j = i + 1; j < vectors.length; j++) scores.push(cosine(vectors[i], vectors[j]))
  if (scores.length < 10) return null
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length
  const sd = Math.sqrt(scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length)
  return { mean, sd }
}

const cutoffFor = (stats: DeckStats | null, z: number) => Math.max(thresholds.relatedFloor, stats ? stats.mean + z * stats.sd : 0)

/** Places a cosine score on a bar that starts at the deck's typical similarity, where unrelated slides already sit. */
export function scorePosition(value: number, typical: number): number {
  if (typical >= 1) return value >= 1 ? 1 : 0
  return Math.min(1, Math.max(0, (value - typical) / (1 - typical)))
}

/** Embedding scores are compressed, so "related" is judged against how similar this deck's slides are to each other. */
export function relatedCutoff(texts: SlideTexts[], vectorOf: VectorLookup): number {
  return cutoffFor(deckStats(texts, vectorOf), thresholds.relatedZScore)
}

function allMatches(source: SlideTexts, texts: SlideTexts[], vectorOf: VectorLookup, cutoff: number): SlideMatch[] {
  const semantic = source.words.size >= minSemanticWords
  const matches: SlideMatch[] = []

  for (const other of texts) {
    if (other.number === source.number) continue
    const overlap = wordOverlap(source.words, other.words)
    const notesScore = score(source.notes, other.notes, vectorOf)
    let kind: MatchKind | null = null
    let contentScore: number | null = null

    if (source.normalized && source.normalized === other.normalized) kind = 'identical'
    else if (semantic && other.words.size >= minSemanticWords) {
      contentScore = score(source.visible, other.visible, vectorOf)
      const cosineValue = contentScore ?? 0
      if (overlap >= thresholds.duplicateWordOverlap
        || (cosineValue >= thresholds.duplicateCosine && overlap >= thresholds.duplicateCosineWordOverlap)) kind = 'near-duplicate'
      else if (cosineValue >= cutoff) kind = 'related'
    }

    if (kind) matches.push({ number: other.number, kind, contentScore, notesScore, wordOverlap: overlap })
  }

  return matches.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || (b.contentScore ?? 1) - (a.contentScore ?? 1) || a.number - b.number)
}

export function findMatches(target: number, texts: SlideTexts[], vectorOf: VectorLookup, cutoff: number = thresholds.relatedFloor): SlideMatch[] {
  const source = texts.find((t) => t.number === target)
  return source ? allMatches(source, texts, vectorOf, cutoff).slice(0, maxMatches) : []
}

export interface DuplicateGroup {
  id: number
  slides: number[]
}

export interface Topic {
  id: number
  label: string
  slides: number[]
}

export interface SlideSimilaritySummary {
  matches: SlideMatch[]
  duplicateGroup: DuplicateGroup | null
  topic: Topic | null
}

export interface DeckAnalysis {
  relatedCutoff: number
  /** Mean slide-to-slide similarity in this deck; unrelated slides score around here. */
  typical: number
  topicCutoff: number
  duplicateGroups: DuplicateGroup[]
  topics: Topic[]
  bySlide: Map<number, SlideSimilaritySummary>
}

/** Slides joined by identical or near-duplicate edges, transitively. */
function duplicateGroupsOf(numbers: number[], matches: Map<number, SlideMatch[]>): DuplicateGroup[] {
  const parent = new Map(numbers.map((n) => [n, n]))
  const find = (n: number): number => {
    const p = parent.get(n)!
    if (p === n) return n
    const root = find(p)
    parent.set(n, root)
    return root
  }
  for (const [n, list] of matches) {
    for (const m of list) if (m.kind !== 'related') parent.set(find(n), find(m.number))
  }
  const groups = new Map<number, number[]>()
  for (const n of numbers) {
    const root = find(n)
    groups.set(root, [...(groups.get(root) ?? []), n])
  }
  return [...groups.values()]
    .filter((slides) => slides.length > 1)
    .map((slides, index) => ({ id: index + 1, slides: slides.sort((a, b) => a - b) }))
}

/** Average-linkage clustering: merge the closest groups while their average similarity stays above the cutoff. */
export function clusterSlides(items: { number: number; vector: Float32Array }[], cutoff: number): number[][] {
  const clusters = items.map((item) => [item.number])
  const sim = items.map((a) => items.map((b) => cosine(a.vector, b.vector)))
  const alive = items.map(() => true)

  for (;;) {
    let best = -Infinity
    let pair: [number, number] | null = null
    for (let i = 0; i < clusters.length; i++) {
      if (!alive[i]) continue
      for (let j = i + 1; j < clusters.length; j++) {
        if (alive[j] && sim[i][j] > best) { best = sim[i][j]; pair = [i, j] }
      }
    }
    if (!pair || best < cutoff) break
    const [i, j] = pair
    const sizeI = clusters[i].length
    const sizeJ = clusters[j].length
    for (let k = 0; k < clusters.length; k++) {
      if (!alive[k] || k === i || k === j) continue
      sim[i][k] = sim[k][i] = (sizeI * sim[i][k] + sizeJ * sim[j][k]) / (sizeI + sizeJ)
    }
    clusters[i] = [...clusters[i], ...clusters[j]]
    alive[j] = false
  }

  return clusters.filter((cluster, index) => alive[index] && cluster.length > 1).map((cluster) => cluster.sort((a, b) => a - b))
}

const stopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'its', 'new', 'now', 'of', 'on', 'or',
  'the', 'to', 'with', 'your', 'you', 'we', 'our', 'what', 'why', 'will', 'de', 'het', 'een', 'en', 'van', 'voor', 'met', 'op', 'te', 'in', 'is',
])

function titleWords(title: string): string[] {
  return [...new Set(normalizeText(title).split(' ').filter((w) => w.length > 1 && !stopWords.has(w) && !/^\d+$/.test(w)))]
}

/** Names a topic after the title words most of its slides share and the rest of the deck mostly lacks. */
export function topicLabel(slides: number[], titles: Map<number, string>): string {
  const deckCount = new Map<string, number>()
  for (const title of titles.values()) for (const w of titleWords(title)) deckCount.set(w, (deckCount.get(w) ?? 0) + 1)
  const groupCount = new Map<string, number>()
  for (const n of slides) for (const w of titleWords(titles.get(n) ?? '')) groupCount.set(w, (groupCount.get(w) ?? 0) + 1)

  const ranked = [...groupCount]
    .map(([word, count]) => ({ word, count, share: count / slides.length, lift: count / slides.length - (deckCount.get(word) ?? 0) / titles.size }))
    .filter((w) => w.count >= 2 && w.share >= 0.5 && w.lift > 0)
    .sort((a, b) => b.lift - a.lift || b.share - a.share)
  const words = ranked
    .filter((w) => w.lift >= ranked[0].lift / 2)
    .slice(0, 3)
    .map((w) => w.word)
  if (words.length) return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
  return titles.get(slides[0])?.trim() || `Slides ${slides.join(', ')}`
}

export function analyzeDeck(texts: SlideTexts[], vectorOf: VectorLookup, titles: Map<number, string>): DeckAnalysis {
  const stats = deckStats(texts, vectorOf)
  const related = cutoffFor(stats, thresholds.relatedZScore)
  const topicCutoff = cutoffFor(stats, thresholds.topicZScore)
  const matches = new Map(texts.map((t) => [t.number, allMatches(t, texts, vectorOf, related)]))
  const duplicateGroups = duplicateGroupsOf(texts.map((t) => t.number), matches)

  const items = texts
    .filter((t) => t.words.size >= minSemanticWords)
    .map((t) => ({ number: t.number, vector: vectorOf(t.visible) }))
    .filter((item): item is { number: number; vector: Float32Array } => item.vector !== undefined)
  const labels = new Map<string, number>()
  const topics = clusterSlides(items, topicCutoff)
    .sort((a, b) => a[0] - b[0])
    .map((slides, index) => {
      const base = topicLabel(slides, titles)
      const seen = (labels.get(base) ?? 0) + 1
      labels.set(base, seen)
      return { id: index + 1, label: seen > 1 ? `${base} (${seen})` : base, slides }
    })

  const bySlide = new Map<number, SlideSimilaritySummary>(texts.map((t) => [t.number, {
    matches: (matches.get(t.number) ?? []).slice(0, maxMatches),
    duplicateGroup: duplicateGroups.find((g) => g.slides.includes(t.number)) ?? null,
    topic: topics.find((topic) => topic.slides.includes(t.number)) ?? null,
  }]))

  return { relatedCutoff: related, typical: Math.min(stats?.mean ?? 0.8, related - 0.02), topicCutoff, duplicateGroups, topics, bySlide }
}

/** E5 models expect a prefix; slide-to-slide comparison is symmetric, so both sides use "query:". */
export function e5Input(text: string): string {
  return `query: ${text}`
}
