import { Copy } from 'lucide-react'
import type { SlideState } from '../api/types'
import type { SlideSimilarity } from '../hooks/useSlideSimilarity'
import { hrefFor } from '../hooks/useRoute'
import { embeddingDownloadLabel, embeddingModelLabel, matchLabels, minSemanticWords, scorePosition, thresholds, type DeckAnalysis, type SlideMatch } from '../lib/similarity'
import { slideTitle } from '../lib/strip'

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`

interface ScoreBarProps {
  label: string
  /** 0–1 position of the fill. */
  fill: number | null
  /** 0–1 position of the threshold tick. */
  tick: number
  value: string
  description: string
}

function ScoreBar({ label, fill, tick, value, description }: ScoreBarProps) {
  return (
    <div className="score-row" data-empty={fill === null || undefined}>
      <span className="score-label">{label}</span>
      <span className="score-track" aria-hidden="true">
        {fill !== null && <span className="score-fill" style={{ width: percent(fill) }} />}
        <span className="score-tick" style={{ left: percent(tick) }} />
      </span>
      <span className="score-value">{value}</span>
      <span className="visually-hidden">{description}</span>
    </div>
  )
}

/** Content and notes start at the deck's typical similarity; shared words use the full 0–100% range. */
function MatchScores({ match, analysis }: { match: SlideMatch; analysis: DeckAnalysis }) {
  const { typical, relatedCutoff } = analysis
  const cosineBar = (label: string, score: number | null) => (
    <ScoreBar label={label} fill={score === null ? null : scorePosition(score, typical)} tick={scorePosition(relatedCutoff, typical)}
      value={score === null ? 'no text' : score.toFixed(2)}
      description={score === null ? `${label}: not compared.` : `${label} similarity ${score.toFixed(2)}; related from ${relatedCutoff.toFixed(2)}, typical ${typical.toFixed(2)}.`} />
  )
  return (
    <div className="match-scores">
      {cosineBar('Content', match.contentScore)}
      {cosineBar('Notes', match.notesScore)}
      <ScoreBar label="Shared words" fill={match.wordOverlap} tick={thresholds.duplicateWordOverlap} value={percent(match.wordOverlap)}
        description={`Shared words ${percent(match.wordOverlap)}; likely duplicate from ${percent(thresholds.duplicateWordOverlap)}.`} />
    </div>
  )
}

/** Start button, download/embedding progress and errors; shared by the storyboard and the slide panel. */
export function SimilarityRunner({ similarity, compact }: { similarity: SlideSimilarity; compact?: boolean }) {
  const { status, progress } = similarity
  if (status === 'checking') return compact ? null : <p className="quiet">Checking this browser for saved comparisons…</p>
  if (status === 'running') {
    return (
      <span className="similarity-running" role="status">
        <span className="pulse" aria-hidden="true" />
        {progress?.phase === 'download'
          ? progress.cached
            ? 'Loading the model from this browser…'
            : `Downloading model… ${megabytes(progress.loaded)} of ${megabytes(progress.total)}`
          : progress?.phase === 'embed'
            ? `Comparing slide text… ${progress.done} of ${progress.total}`
            : 'Starting the local model…'}
      </span>
    )
  }
  if (status === 'ready') return null
  const label = similarity.partial ? 'Update comparison' : status === 'error' ? 'Try again' : compact ? 'Compare slides' : 'Find similar slides'
  return (
    <span className="similarity-start">
      <button type="button" className="key key-small" onClick={similarity.run}
        title={similarity.partial ? undefined : `Runs ${embeddingModelLabel} in this browser. The first run downloads ${embeddingDownloadLabel}.`}>
        <Copy size={15} aria-hidden="true" />{label}
      </button>
      {status === 'error' && <span className="decision-error" role="alert">Comparison failed: {similarity.error}</span>}
      {!compact && (
        <span className="quiet">
          {similarity.partial
            ? `${similarity.missing} changed ${similarity.missing === 1 ? 'text needs' : 'texts need'} comparing before results are complete.`
            : `Compares every slide in this deck with ${embeddingModelLabel}, running in this browser. The first run downloads the model (${embeddingDownloadLabel}) from Hugging Face; slide text is not sent anywhere.`}
        </span>
      )}
    </span>
  )
}

interface SimilarSlidesProps {
  deckId: string
  slideNumber: number
  slides: SlideState[]
  similarity: SlideSimilarity
}

export function SimilarSlides({ deckId, slideNumber, slides, similarity }: SimilarSlidesProps) {
  const { analysis } = similarity
  const summary = analysis?.bySlide.get(slideNumber)
  const texts = similarity.textsFor(slideNumber)
  const lowContent = !texts || texts.words.size < minSemanticWords
  const bySlide = new Map(slides.map((s) => [s.content.number, s]))
  const slideLinks = (numbers: number[]) => numbers.map((n, i) => (
    <span key={n}>{i > 0 && ', '}{n === slideNumber ? n : <a href={hrefFor({ view: 'deck', deckId, slide: n })}>{n}</a>}</span>
  ))

  return (
    <section className="similar-slides" aria-label="Similar slides">
      <h3>Similar slides</h3>
      <SimilarityRunner similarity={similarity} />

      {analysis && summary && (
        <>
          {summary.duplicateGroup && <p className="similar-duplicate">Likely duplicates: slides {slideLinks(summary.duplicateGroup.slides)}.</p>}
          {summary.topic && <p className="quiet">Topic <strong>{summary.topic.label}</strong> · slides {slideLinks(summary.topic.slides)}</p>}
          {lowContent && <p className="quiet">This slide has too little text for a meaning-based comparison; only identical text is checked.</p>}
          {summary.matches.length ? (
            <ol className="similar-list">
              {summary.matches.map((match) => {
                const other = bySlide.get(match.number)
                return (
                  <li key={match.number} data-kind={match.kind}>
                    <a href={hrefFor({ view: 'deck', deckId, slide: match.number })}>
                      <span className="similar-kind">{matchLabels[match.kind]}</span>
                      <span>Slide {match.number}: {other ? slideTitle(other) : ''}</span>
                    </a>
                    <MatchScores match={match} analysis={analysis} />
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="quiet">No similar slides in this deck.</p>
          )}
          {summary.matches.length > 0 && (
            <p className="score-legend quiet">
              <span className="score-legend-tick" aria-hidden="true" /> marks the threshold: related from {analysis.relatedCutoff.toFixed(2)}, likely duplicate from {percent(thresholds.duplicateWordOverlap)} shared words.
              Content and notes bars start at {analysis.typical.toFixed(2)}, how alike two unrelated slides in this deck typically are.
            </p>
          )}
          <p className="quiet">Scores are cosine similarity from {embeddingModelLabel}; thresholds are provisional. Template text repeated across the deck is ignored.</p>
        </>
      )}
    </section>
  )
}
