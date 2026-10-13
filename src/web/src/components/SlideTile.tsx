import { Copy, EyeOff, Sparkles } from 'lucide-react'
import type { SlideState } from '../api/types'
import { hrefFor } from '../hooks/useRoute'
import type { SlideSimilaritySummary } from '../lib/similarity'
import { contentPreview } from '../lib/storyboard'
import { notesLabels, slideTitle, stateLabel } from '../lib/strip'

interface SlideTileProps {
  deckId: string
  slide: SlideState
  active: boolean
  selected: boolean
  unseen: boolean
  onToggle: () => void
  similar?: SlideSimilaritySummary
  /** False when the storyboard is already grouped by topic, so the chip would repeat the heading. */
  showTopic?: boolean
}

const topicHues = 6
const others = (slides: number[], self: number) => {
  const rest = slides.filter((n) => n !== self)
  return `${rest.length === 1 ? 'slide' : 'slides'} ${rest.join(', ')}`
}

export function SlideTile({ deckId, slide, active, selected, unseen, onToggle, similar, showTopic = true }: SlideTileProps) {
  const { content, assessment } = slide
  const title = slideTitle(slide)
  const state = tileState(slide)
  return (
    <li className="slide-tile" data-selected={selected || undefined} data-active={active || undefined} data-skip={assessment.suggestSkip || undefined}>
      <div className="tile-designator">
        <label className="tile-selection">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select slide ${content.number}: ${title}`} />
          <span>Slide {content.number}</span>
        </label>
        {content.hidden && <span className="tile-hidden"><EyeOff size={13} aria-hidden="true" /> Hidden</span>}
      </div>
      <a
        className="tile-preview"
        href={hrefFor({ view: 'deck', deckId, slide: content.number })}
        aria-current={active ? 'page' : undefined}
        aria-label={`Open slide ${content.number}: ${title}`}
      >
        <span className="tile-section">{content.section || 'No section'}</span>
        <h4 title={title}>{title}</h4>
        <p className="tile-excerpt">{contentPreview(slide)}</p>
        <span className="preview-label">Content preview · extracted text</span>
      </a>
      <div className="tile-status">
        {state.tone === 'running'
          ? <span className="tile-running"><span className="pulse" aria-hidden="true" />Researching&nbsp;…</span>
          : state.tone
            ? <span className="workflow-state" data-tone={state.tone}>{state.label}</span>
            : <span className="notes-health">{state.label}</span>}
        {assessment.suggestSkip && <span className="tile-skip">{assessment.kind} · suggested skip</span>}
        {unseen && <span className="new-proposal"><Sparkles size={12} aria-hidden="true" /> New proposal</span>}
      </div>
      {similar && (similar.duplicateGroup || similar.topic) && (
        <div className="tile-similarity">
          {similar.duplicateGroup && (
            <span className="tile-duplicate">
              <Copy size={12} aria-hidden="true" />
              Likely duplicate of {others(similar.duplicateGroup.slides, content.number)}
            </span>
          )}
          {similar.topic && showTopic && (
            <span className="tile-topic" data-hue={similar.topic.id % topicHues} title={`Topic shared by slides ${similar.topic.slides.join(', ')}`}>
              {similar.topic.label}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

type TileTone = 'running' | 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | null

/** One status per card: workflow state when it exists, otherwise notes health. Healthy states stay quiet text. */
function tileState(slide: SlideState): { tone: TileTone; label: string } {
  const { assessment } = slide
  if (slide.status === 'Running') return { tone: 'running', label: stateLabel(slide) }
  if (slide.status === 'Queued') return { tone: 'neutral', label: 'Queued' }
  if (slide.status === 'Failed') return { tone: 'danger', label: 'Research failed' }
  if (slide.review === 'Pending') return { tone: 'brand', label: 'To review' }
  if (slide.review === 'Accepted') return { tone: 'success', label: 'Accepted' }
  if (slide.review === 'Rejected') return { tone: null, label: 'Proposal rejected' }
  if (slide.status === 'Cancelled') return { tone: null, label: 'Research cancelled' }
  if (assessment.flagged && !assessment.suggestSkip) return { tone: 'warning', label: `Notes: ${notesLabels[assessment.notesStatus]}` }
  return { tone: null, label: `Notes: ${notesLabels[assessment.notesStatus]}` }
}
