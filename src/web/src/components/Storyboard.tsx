import { Radar, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { SlideState } from '../api/types'
import type { SlideSimilarity } from '../hooks/useSlideSimilarity'
import { groupingLabels, toggleVisibleSelection, type Grouping, type StoryboardGroup } from '../lib/storyboard'
import { bayCounts, bayLabels, enrichableFlagged, proposalKey, type BayFilter } from '../lib/strip'
import { SimilarityRunner } from './SimilarSlides'
import { SlideTile } from './SlideTile'

interface StoryboardProps {
  deckId: string
  slides: SlideState[]
  visible: SlideState[]
  groups: StoryboardGroup[]
  grouping: Grouping
  onGrouping: (grouping: Grouping) => void
  similarity: SlideSimilarity
  activeNumber: number
  filter: BayFilter
  search: string
  onFilter: (filter: BayFilter) => void
  onSearch: (search: string) => void
  selected: ReadonlySet<number>
  onSelectionChange: (next: Set<number>) => void
  seen: ReadonlySet<string>
  ready: boolean
  modelName: string
  enriching: boolean
  onEnrich: (slides: number[] | null) => void
}

const filters: BayFilter[] = ['all', 'attention', 'research', 'review', 'cleared']
const groupings: Grouping[] = ['section', 'topic', 'duplicates']
const emptyResults: Record<BayFilter, string> = {
  all: 'This deck has no slides.',
  attention: 'No slides need notes right now.',
  research: 'No slides are in research.',
  review: 'No proposals are waiting for review.',
  cleared: 'No notes have been accepted yet.',
}

export function Storyboard(props: StoryboardProps) {
  const { slides, visible, selected, filter, search } = props
  const { analysis } = props.similarity
  const [confirmation, setConfirmation] = useState<number[] | null>(null)
  const counts = bayCounts(slides)
  const flagged = enrichableFlagged(slides).map((s) => s.content.number)
  const selection = slides.filter((s) => selected.has(s.content.number)).map((s) => s.content.number)
  const target = selection.length ? selection : flagged
  const allSelected = visible.length > 0 && visible.every((s) => selected.has(s.content.number))
  const someSelected = visible.some((s) => selected.has(s.content.number))

  return (
    <section className="storyboard" aria-label="Deck storyboard">
      <header className="storyboard-head">
        <div className="storyboard-heading">
          <h2>Storyboard</h2>
          <div className="similarity-bar">
            {analysis ? (
              <>
                <label className="grouping">
                  Group by
                  <select value={props.grouping} onChange={(e) => props.onGrouping(e.target.value as Grouping)}>
                    {groupings.map((g) => (
                      <option key={g} value={g} disabled={g === 'duplicates' && !analysis.duplicateGroups.length}>{groupingLabels[g]}</option>
                    ))}
                  </select>
                </label>
                <span className="similarity-summary">
                  {analysis.duplicateGroups.length
                    ? <strong>{analysis.duplicateGroups.length} likely duplicate {analysis.duplicateGroups.length === 1 ? 'set' : 'sets'}</strong>
                    : 'No likely duplicates'}
                  {' · '}{analysis.topics.length} {analysis.topics.length === 1 ? 'topic' : 'topics'}
                </span>
                {props.similarity.partial && <SimilarityRunner similarity={props.similarity} compact />}
              </>
            ) : (
              <SimilarityRunner similarity={props.similarity} compact />
            )}
          </div>
          <label className="slide-search">
            <Search size={16} aria-hidden="true" />
            <span className="visually-hidden">Find a slide by title, section, or number</span>
            <input type="search" placeholder="Find a slide" value={search} onChange={(e) => props.onSearch(e.target.value)} />
          </label>
        </div>
        <div className="workflow-filters" role="group" aria-label="Filter slides by workflow" aria-describedby="filter-explanation">
          {filters.map((f) => (
            <button type="button" key={f} aria-pressed={filter === f} onClick={() => props.onFilter(f)}>
              {bayLabels[f]} <span>{counts[f]}</span>
            </button>
          ))}
        </div>
        <p id="filter-explanation" className="visually-hidden">Workflow counts cover the entire deck. Notes health is assessed separately.</p>
        <div className="storyboard-actions">
          <label className="select-visible">
            <input type="checkbox" checked={allSelected} disabled={!visible.length}
              ref={(element) => { if (element) element.indeterminate = someSelected && !allSelected }}
              onChange={() => props.onSelectionChange(toggleVisibleSelection(selected, visible))} />
            {allSelected ? 'Deselect visible' : 'Select visible'}
          </label>
          <span className="command-divider" aria-hidden="true" />
          <button type="button" className={`key key-small${selection.length ? ' key-primary' : ''}`} disabled={!props.ready || !target.length || props.enriching}
            onClick={() => setConfirmation(target)}>
            <Radar size={15} aria-hidden="true" />
            {props.enriching ? 'Sending…' : selection.length ? `Research ${selection.length} selected` : flagged.length ? `Research ${flagged.length} flagged` : 'No flagged slides waiting'}
          </button>
          {selection.length > 0 && <button type="button" className="key key-small key-quiet" onClick={() => props.onSelectionChange(new Set())}><X size={14} aria-hidden="true" /> Clear selection</button>}
          <p className="results-summary">{visible.length} of {slides.length} slides shown · {selection.length} selected across the deck<span className="keyboard-hint"> · <kbd>J</kbd> <kbd>K</kbd> to move</span></p>
        </div>
        {!props.ready && <p className="operational-note">Copilot is unavailable. You can still review or write notes; reconnect to research.</p>}
        {confirmation && (
          <div className="research-confirm" role="group" aria-label="Confirm batch research">
            <p>Research {confirmation.length} slides with <strong>{props.modelName}</strong>? Research uses your Copilot premium requests. Existing proposals on selected slides will be replaced.</p>
            <div className="action-row">
              <button type="button" className="key key-primary" disabled={!props.ready || props.enriching} onClick={() => {
                props.onEnrich(confirmation)
                setConfirmation(null)
              }}>Start research</button>
              <button type="button" className="key" onClick={() => setConfirmation(null)}>Cancel</button>
            </div>
          </div>
        )}
      </header>
      <div className="storyboard-scroll" tabIndex={-1}>
        {!visible.length ? (
          <div className="empty-state">
            <h3>{search.trim() ? 'No matching slides' : props.grouping === 'duplicates' ? 'No likely duplicates among these slides.' : emptyResults[filter]}</h3>
            {search.trim() && <p>Try a different title, section, or slide number.</p>}
            {(search || filter !== 'all') && <button className="key" type="button" onClick={() => { props.onSearch(''); props.onFilter('all') }}>Clear search and filters</button>}
          </div>
        ) : props.groups.map((group) => (
          <section className="storyboard-section" key={group.key} aria-label={group.heading}>
            <h3 className="section-heading">{group.heading}</h3>
            <ul className="slide-grid">
              {group.slides.map((slide) => {
                const key = proposalKey(slide)
                return <SlideTile key={slide.content.number} deckId={props.deckId} slide={slide}
                  active={slide.content.number === props.activeNumber} selected={selected.has(slide.content.number)}
                  unseen={slide.review === 'Pending' && key !== null && !props.seen.has(key)}
                  similar={analysis?.bySlide.get(slide.content.number)}
                  showTopic={props.grouping !== 'topic'}
                  onToggle={() => {
                    const next = new Set(selected)
                    if (next.has(slide.content.number)) next.delete(slide.content.number)
                    else next.add(slide.content.number)
                    props.onSelectionChange(next)
                  }} />
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
