import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Columns3,
  ExternalLink,
  FileDown,
  LayoutGrid,
  RotateCcw,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { hrefFor, type Route } from '../../hooks/useRoute'

type Concept = Extract<Route, { view: 'mockups' }>['concept']
type Decision = 'review' | 'accepted' | 'revision'

interface MockSlide {
  number: number
  title: string
  section: string
  status: 'Needs notes' | 'Ready to review' | 'Researching' | 'Notes healthy'
  confidence: 'High' | 'Medium'
  original: string
  proposal: string
  rationale: string
  sources: { title: string; host: string }[]
  flags: string[]
}

const concepts: { id: Concept; label: string; short: string; icon: typeof Columns3 }[] = [
  { id: 'focus', label: 'Focus lanes', short: 'Triage, compare, decide', icon: Columns3 },
  { id: 'storyboard', label: 'Storyboard', short: 'See the deck as a narrative', icon: LayoutGrid },
  { id: 'evidence', label: 'Evidence lens', short: 'Lead with claims and sources', icon: ScanSearch },
]

const slides: MockSlide[] = [
  {
    number: 12,
    title: 'Why migrate now',
    section: 'Business case',
    status: 'Ready to review',
    confidence: 'High',
    original: 'Explain the urgency and mention the current renewal window.',
    proposal:
      'Frame the migration around the renewal window in Q1 2027. Moving before renewal avoids another hardware cycle and creates one decision point for infrastructure, security, and AI readiness.',
    rationale: 'Adds a specific decision window and replaces generic urgency with three presenter-ready reasons.',
    sources: [
      { title: 'Cloud Adoption Framework: Strategy', host: 'learn.microsoft.com' },
      { title: '2026 infrastructure renewal brief', host: 'contoso.sharepoint.com' },
    ],
    flags: ['Time-sensitive', '2 sources'],
  },
  {
    number: 18,
    title: 'Responsible AI operating model',
    section: 'AI readiness',
    status: 'Needs notes',
    confidence: 'Medium',
    original: '',
    proposal:
      'Introduce the operating model as a shared responsibility across product, security, legal, and platform teams. Emphasize that controls should follow the AI lifecycle rather than appear only at launch.',
    rationale: 'Creates a concise talk track from the diagram while keeping governance ownership explicit.',
    sources: [{ title: 'Microsoft Responsible AI Standard', host: 'microsoft.com' }],
    flags: ['New draft', '1 source'],
  },
  {
    number: 23,
    title: 'Landing zone workstreams',
    section: 'Delivery plan',
    status: 'Researching',
    confidence: 'High',
    original: 'Walk through the workstreams. Call out identity first.',
    proposal:
      'Start with identity and policy because they define the guardrails for every later workstream. Then connect platform automation, networking, and operations as parallel tracks with shared readiness gates.',
    rationale: 'Preserves the presenter cue and adds a clear sequence for explaining a dense slide.',
    sources: [{ title: 'Azure landing zone design areas', host: 'learn.microsoft.com' }],
    flags: ['Working', '1 source'],
  },
  {
    number: 31,
    title: 'Next-step workshop',
    section: 'Close',
    status: 'Notes healthy',
    confidence: 'High',
    original: 'Confirm workshop owners, desired outcomes, and the two-week preparation window.',
    proposal: 'Confirm workshop owners, desired outcomes, and the two-week preparation window.',
    rationale: 'The current notes are concise, specific, and already match the slide.',
    sources: [],
    flags: ['No change'],
  },
]

export function FluentMockups({ concept }: { concept: Concept }) {
  const [activeNumber, setActiveNumber] = useState(12)
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [query, setQuery] = useState('')
  const [showChanges, setShowChanges] = useState(true)
  const active = slides.find((slide) => slide.number === activeNumber) ?? slides[0]
  const visibleSlides = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return slides
    return slides.filter((slide) => `${slide.number} ${slide.title} ${slide.section}`.toLowerCase().includes(normalized))
  }, [query])
  const decision = decisions[active.number] ?? 'review'

  const decide = (next: Decision) => {
    setDecisions((current) => ({ ...current, [active.number]: next }))
  }

  return (
    <div className="fm-shell" data-concept={concept}>
      <header className="fm-topbar">
        <a className="fm-back" href="#/" aria-label="Back to Notes Enricher">
          <ArrowLeft size={18} />
          <span>Notes Enricher</span>
        </a>
        <nav className="fm-concepts" aria-label="Mockup concepts">
          {concepts.map((item) => {
            const Icon = item.icon
            return (
              <a
                key={item.id}
                className="fm-concept-link"
                data-active={concept === item.id || undefined}
                href={hrefFor({ view: 'mockups', concept: item.id })}
                aria-current={concept === item.id ? 'page' : undefined}
              >
                <Icon size={16} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.short}</small>
                </span>
              </a>
            )
          })}
        </nav>
        <button className="fm-export" type="button">
          <FileDown size={16} />
          Export 1 accepted
        </button>
      </header>

      <div className="fm-context">
        <div>
          <h1>Azure AI transformation workshop</h1>
          <p>43 slides · 7 need attention · Copilot connected</p>
        </div>
        <div className="fm-progress" aria-label="Deck progress">
          <span><b>36</b> healthy</span>
          <span><b>4</b> to review</span>
          <span><b>3</b> researching</span>
        </div>
      </div>

      {concept === 'focus' && (
        <FocusLanes
          slides={visibleSlides}
          active={active}
          activeNumber={activeNumber}
          decision={decision}
          query={query}
          showChanges={showChanges}
          onQuery={setQuery}
          onSelect={setActiveNumber}
          onDecision={decide}
          onShowChanges={setShowChanges}
        />
      )}
      {concept === 'storyboard' && (
        <Storyboard
          slides={visibleSlides}
          active={active}
          activeNumber={activeNumber}
          decision={decision}
          query={query}
          onQuery={setQuery}
          onSelect={setActiveNumber}
          onDecision={decide}
        />
      )}
      {concept === 'evidence' && (
        <EvidenceLens
          slides={visibleSlides}
          active={active}
          activeNumber={activeNumber}
          decision={decision}
          onSelect={setActiveNumber}
          onDecision={decide}
        />
      )}
    </div>
  )
}

interface ConceptProps {
  slides: MockSlide[]
  active: MockSlide
  activeNumber: number
  decision: Decision
  onSelect: (number: number) => void
  onDecision: (decision: Decision) => void
}

function FocusLanes(
  props: ConceptProps & {
    query: string
    showChanges: boolean
    onQuery: (query: string) => void
    onShowChanges: (value: boolean) => void
  },
) {
  return (
    <main className="fm-focus">
      <aside className="fm-queue">
        <QueueHeader query={props.query} onQuery={props.onQuery} />
        <SlideList {...props} />
      </aside>
      <section className="fm-review">
        <ReviewHeader active={props.active} decision={props.decision} />
        <div className="fm-change-toggle">
          <button type="button" data-active={!props.showChanges || undefined} onClick={() => props.onShowChanges(false)}>
            Read
          </button>
          <button type="button" data-active={props.showChanges || undefined} onClick={() => props.onShowChanges(true)}>
            Changes
          </button>
        </div>
        <NotesComparison active={props.active} showChanges={props.showChanges} />
        <DecisionBar decision={props.decision} onDecision={props.onDecision} />
      </section>
      <aside className="fm-copilot-pane">
        <CopilotSummary active={props.active} />
      </aside>
    </main>
  )
}

function Storyboard(props: ConceptProps & { query: string; onQuery: (query: string) => void }) {
  return (
    <main className="fm-storyboard">
      <section className="fm-board">
        <div className="fm-board-head">
          <div>
            <h2>Deck storyboard</h2>
            <p>Review notes in the context of the story, not as isolated tasks.</p>
          </div>
          <QueueHeader query={props.query} onQuery={props.onQuery} compact />
        </div>
        <div className="fm-slide-grid">
          {props.slides.map((slide) => (
            <button
              type="button"
              className="fm-thumbnail"
              data-active={props.activeNumber === slide.number || undefined}
              key={slide.number}
              onClick={() => props.onSelect(slide.number)}
            >
              <span className="fm-thumb-number">{String(slide.number).padStart(2, '0')}</span>
              <span className="fm-thumb-canvas">
                <span>{slide.section}</span>
                <b>{slide.title}</b>
                <i />
                <i />
                <i />
              </span>
              <span className="fm-thumb-state" data-state={slide.status}>
                {slide.status}
              </span>
            </button>
          ))}
        </div>
      </section>
      <aside className="fm-story-review">
        <ReviewHeader active={props.active} decision={props.decision} />
        <p className="fm-story-rationale">{props.active.rationale}</p>
        <div className="fm-story-note">
          <Sparkles size={17} />
          <p>{props.active.proposal}</p>
        </div>
        <SourceList active={props.active} />
        <DecisionBar decision={props.decision} onDecision={props.onDecision} />
      </aside>
    </main>
  )
}

function EvidenceLens(props: ConceptProps) {
  return (
    <main className="fm-evidence">
      <aside className="fm-evidence-index">
        <h2>Evidence map</h2>
        <p>Review the claims Copilot introduced before reviewing its prose.</p>
        <div className="fm-claim-list">
          {props.slides.map((slide) => (
            <button
              type="button"
              key={slide.number}
              data-active={props.activeNumber === slide.number || undefined}
              onClick={() => props.onSelect(slide.number)}
            >
              <span>{String(slide.number).padStart(2, '0')}</span>
              <span>
                <strong>{slide.title}</strong>
                <small>
                  {slide.sources.length} verified {slide.sources.length === 1 ? 'source' : 'sources'} · {slide.confidence}{' '}
                  confidence
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </aside>
      <section className="fm-evidence-note">
        <ReviewHeader active={props.active} decision={props.decision} />
        <div className="fm-trust-banner">
          <ShieldCheck size={20} />
          <p>
            <strong>Grounded draft</strong>
            Every factual addition below is linked to evidence. Presenter guidance remains clearly labeled.
          </p>
        </div>
        <div className="fm-annotated-note">
          <p>{props.active.proposal}</p>
          <button type="button">1</button>
          <button type="button">2</button>
        </div>
        <DecisionBar decision={props.decision} onDecision={props.onDecision} />
      </section>
      <aside className="fm-source-inspector">
        <div className="fm-source-heading">
          <BookOpen size={18} />
          <h2>Source inspector</h2>
        </div>
        <p className="fm-source-callout">{props.active.rationale}</p>
        <SourceList active={props.active} detailed />
        <div className="fm-ai-disclosure">
          <Sparkles size={16} />
          <p>
            Generated by GPT-5. Sources were retrieved on 13 Oct 2026. Verify time-sensitive claims before presenting.
          </p>
        </div>
      </aside>
    </main>
  )
}

function QueueHeader({
  query,
  onQuery,
  compact = false,
}: {
  query: string
  onQuery: (query: string) => void
  compact?: boolean
}) {
  return (
    <div className="fm-queue-head" data-compact={compact || undefined}>
      {!compact && (
        <div>
          <h2>Needs attention</h2>
          <span>7 slides</span>
        </div>
      )}
      <label className="fm-search">
        <Search size={16} />
        <span className="visually-hidden">Find a slide</span>
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Find a slide" />
      </label>
    </div>
  )
}

function SlideList({ slides: visible, activeNumber, onSelect }: ConceptProps) {
  return (
    <div className="fm-slide-list">
      {visible.map((slide) => (
        <button
          type="button"
          key={slide.number}
          data-active={activeNumber === slide.number || undefined}
          onClick={() => onSelect(slide.number)}
        >
          <span className="fm-slide-number">{String(slide.number).padStart(2, '0')}</span>
          <span className="fm-slide-copy">
            <strong>{slide.title}</strong>
            <small>{slide.section}</small>
          </span>
          <span className="fm-status-dot" data-state={slide.status} aria-label={slide.status} />
        </button>
      ))}
    </div>
  )
}

function ReviewHeader({ active, decision }: { active: MockSlide; decision: Decision }) {
  return (
    <header className="fm-review-head">
      <div>
        <span>Slide {active.number} · {active.section}</span>
        <h2>{active.title}</h2>
      </div>
      <span className="fm-decision-state" data-decision={decision}>
        {decision === 'accepted' ? <Check size={14} /> : decision === 'revision' ? <RotateCcw size={14} /> : <Clock3 size={14} />}
        {decision === 'accepted' ? 'Accepted' : decision === 'revision' ? 'Revision requested' : 'Awaiting review'}
      </span>
    </header>
  )
}

function NotesComparison({ active, showChanges }: { active: MockSlide; showChanges: boolean }) {
  return (
    <div className="fm-notes">
      <section>
        <h3>Current notes</h3>
        <p className={!active.original ? 'fm-empty-note' : undefined}>
          {active.original || 'No speaker notes were found on this slide.'}
        </p>
      </section>
      <section className="fm-proposed-note">
        <h3><Sparkles size={16} /> Copilot draft</h3>
        <p>
          {showChanges ? (
            <>
              <mark>{active.proposal.split('. ')[0]}.</mark>{' '}
              {active.proposal.split('. ').slice(1).join('. ')}
            </>
          ) : active.proposal}
        </p>
      </section>
    </div>
  )
}

function CopilotSummary({ active }: { active: MockSlide }) {
  return (
    <>
      <div className="fm-copilot-title">
        <span><Sparkles size={17} /></span>
        <div>
          <h2>Why this changed</h2>
          <p>Copilot · {active.confidence} confidence</p>
        </div>
      </div>
      <p className="fm-rationale">{active.rationale}</p>
      <div className="fm-flags">
        {active.flags.map((flag) => <span key={flag}>{flag}</span>)}
      </div>
      <SourceList active={active} />
      <div className="fm-ai-disclosure">
        <ShieldCheck size={16} />
        <p>AI can make mistakes. Sources and presenter intent should guide the final decision.</p>
      </div>
    </>
  )
}

function SourceList({ active, detailed = false }: { active: MockSlide; detailed?: boolean }) {
  return (
    <section className="fm-sources">
      <h3>Sources</h3>
      {active.sources.length > 0 ? active.sources.map((source, index) => (
        <a href="https://learn.microsoft.com" target="_blank" rel="noreferrer" key={source.title}>
          <span className="fm-source-index">{index + 1}</span>
          <span>
            <strong>{source.title}</strong>
            <small>{source.host}{detailed ? ' · Retrieved today' : ''}</small>
          </span>
          <ExternalLink size={14} />
        </a>
      )) : <p className="fm-no-sources">No external sources were needed for this presenter guidance.</p>}
    </section>
  )
}

function DecisionBar({ decision, onDecision }: { decision: Decision; onDecision: (decision: Decision) => void }) {
  return (
    <div className="fm-decision-bar">
      <button type="button" className="fm-revise" onClick={() => onDecision('revision')}>
        <WandSparkles size={16} />
        Request revision
      </button>
      {decision !== 'review' && (
        <button type="button" className="fm-reset" onClick={() => onDecision('review')}>
          <RotateCcw size={15} />
          Undo
        </button>
      )}
      <button type="button" className="fm-reject" onClick={() => onDecision('revision')} aria-label="Reject draft">
        <X size={17} />
      </button>
      <button type="button" className="fm-accept" onClick={() => onDecision('accepted')}>
        <Check size={17} />
        Accept notes
      </button>
    </div>
  )
}
