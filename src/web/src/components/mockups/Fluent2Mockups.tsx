import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  EyeOff,
  FileDown,
  LayoutPanelLeft,
  Radar,
  Search,
  Square,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { hrefFor } from '../../hooks/useRoute'

type Frame = 'layout' | 'wait' | 'handoff'
type TileState = 'healthy' | 'skip' | 'review' | 'accepted' | 'running' | 'queued' | 'needs'

interface Tile {
  number: number
  section: string
  title: string
  excerpt: string
  state: TileState
  hidden?: boolean
}

const frames: { id: Frame; label: string; hint: string }[] = [
  { id: 'layout', label: 'Layout and elevation', hint: 'Reviewing a proposal' },
  { id: 'wait', label: 'Wait UX', hint: 'Research in progress' },
  { id: 'handoff', label: 'Handoffs', hint: 'Research done, export' },
]

const baseTiles: Tile[] = [
  { number: 1, section: 'Start', title: 'Technical Update Briefing – Azure', excerpt: 'Ruud van den Hooff · Cloud Solution Architect · Unive Services B.V.', state: 'skip' },
  { number: 2, section: 'Start', title: 'Terms and Conditions', excerpt: 'No body text extracted.', state: 'skip' },
  { number: 3, section: 'Start', title: 'Unlocking Innovations with Azure TUB', excerpt: 'No body text extracted.', state: 'healthy' },
  { number: 4, section: 'Start', title: 'Agenda', excerpt: '1 table. No body text extracted.', state: 'skip' },
  { number: 5, section: 'Azure Retirements', title: 'Azure Retirements', excerpt: 'Section divider.', state: 'skip' },
  { number: 6, section: 'Azure Retirements', title: 'Services Retirement Workbook', excerpt: 'Service retirement information is vital for organizations to ensure operational continuity…', state: 'healthy' },
  { number: 7, section: 'Azure Retirements', title: 'Demo – Service Retirement Workbook', excerpt: 'What’s needed for the demo: Azure subscription…', state: 'healthy', hidden: true },
  { number: 8, section: 'Azure Retirements', title: 'Retirement: Azure Linux with OS Guard in Azure Kubernetes Service', excerpt: 'Azure TUB · Retirement date and migration path.', state: 'review' },
  { number: 22, section: 'AI + machine learning', title: 'Foundry Agent Service: what changed this quarter', excerpt: 'Hosted agents, tool catalog, evaluation.', state: 'healthy' },
  { number: 23, section: 'AI + machine learning', title: 'Public Preview: Foundry Routines in Foundry Agent Service', excerpt: 'Schedule and chain agent runs; triggers; run history.', state: 'review' },
  { number: 24, section: 'AI + machine learning', title: 'Model router in Foundry: generally available', excerpt: 'Route prompts across models by cost and quality.', state: 'needs' },
  { number: 25, section: 'AI + machine learning', title: 'Azure OpenAI: regional availability update', excerpt: '1 table · regions and deployment types.', state: 'accepted' },
]

function tilesFor(frame: Frame): Tile[] {
  if (frame === 'layout') return baseTiles
  return baseTiles.map((tile) => {
    if (frame === 'wait') {
      if (tile.number === 24) return { ...tile, state: 'running' }
      if (tile.number === 8) return { ...tile, state: 'queued' }
      if (tile.number === 22) return { ...tile, state: 'queued' }
    }
    if (frame === 'handoff') {
      if (tile.number === 24) return { ...tile, state: 'review' }
      if (tile.number === 23 || tile.number === 8) return { ...tile, state: 'accepted' }
    }
    return tile
  })
}

const activeFor: Record<Frame, number> = { layout: 23, wait: 24, handoff: 24 }

export function Fluent2Mockups() {
  const [frame, setFrame] = useState<Frame>('layout')
  const [annotate, setAnnotate] = useState(true)
  return (
    <div className="f2">
      <header className="f2-gallery">
        <div className="f2-gallery-ident">
          <a className="f2-btn f2-btn-subtle" href={hrefFor({ view: 'home' })}><ArrowLeft size={16} aria-hidden="true" /> App</a>
          <div>
            <h1>Deck review, aligned with Fluent 2</h1>
            <p>Mockup with fixture data. Compare with the live deck tab; nothing here reads or writes a deck.</p>
          </div>
        </div>
        <div className="f2-gallery-controls">
          <div className="f2-segmented" role="tablist" aria-label="Mockup frame">
            {frames.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={frame === item.id} onClick={() => setFrame(item.id)}>
                <strong>{item.label}</strong><span>{item.hint}</span>
              </button>
            ))}
          </div>
          <label className="f2-switch"><input type="checkbox" checked={annotate} onChange={(e) => setAnnotate(e.target.checked)} /> Annotations</label>
        </div>
      </header>

      <div className="f2-stage">
        <div className="f2-device" role="img" aria-label={`Mockup: ${frames.find((f) => f.id === frame)?.label}`}>
          <MockApp frame={frame} />
        </div>
        {annotate && <Annotations frame={frame} />}
      </div>
    </div>
  )
}

function MockApp({ frame }: { frame: Frame }) {
  const tiles = tilesFor(frame)
  const active = activeFor[frame]
  const accepted = tiles.filter((t) => t.state === 'accepted').length
  const sections = [...new Set(tiles.map((t) => t.section))]
  const count = (state: TileState) => tiles.filter((t) => t.state === state).length

  return (
    <div className="f2-app" data-frame={frame}>
      <header className="f2-titlebar">
        <span className="f2-appmark"><LayoutPanelLeft size={18} aria-hidden="true" /> Notes Enricher</span>
        <span className="f2-divider" aria-hidden="true" />
        <div className="f2-deck">
          <strong>Technical Update Briefing – Azure</strong>
          <span>RMOT…-short.pptx · 75 slides</span>
        </div>
        <div className="f2-titlebar-end">
          <span className="f2-presence" data-state="ok"><span className="f2-dot" aria-hidden="true" /> Copilot connected</span>
          <label className="f2-field-inline">Model <span className="f2-select">CLI default <ChevronDown size={14} aria-hidden="true" /></span></label>
          <div className="f2-export-anchor">
            <button type="button" className="f2-btn f2-btn-primary" aria-expanded={frame === 'handoff'}>
              <FileDown size={16} aria-hidden="true" /> Export <span className="f2-count">{accepted}</span>
            </button>
            {frame === 'handoff' && <ExportFlyout />}
          </div>
        </div>
      </header>

      <div className="f2-body">
        <section className="f2-board" aria-label="Storyboard">
          <div className="f2-board-head">
            <div className="f2-board-title">
              <h2>Storyboard</h2>
              <span className="f2-search"><Search size={16} aria-hidden="true" /> Find a slide</span>
            </div>
            <div className="f2-tabs" role="tablist">
              {[
                ['All', 75],
                ['Needs notes', count('needs')],
                ['In research', count('running') + count('queued')],
                ['To review', count('review')],
                ['Accepted', accepted],
              ].map(([label, n], i) => (
                <span key={label} role="tab" aria-selected={i === 0} className="f2-tab">{label}<span className="f2-tab-count">{n}</span></span>
              ))}
            </div>
            <div className="f2-commandbar">
              <label className="f2-check"><input type="checkbox" readOnly /> Select visible</label>
              {count('needs') > 0 && <button type="button" className="f2-btn f2-btn-subtle"><Radar size={16} aria-hidden="true" /> Research flagged ({count('needs')})</button>}
              <span className="f2-commandbar-end">J / K moves between results</span>
            </div>
          </div>

          <div className="f2-scroll">
            {sections.map((section) => (
              <section key={section} className="f2-section">
                <h3>{section}</h3>
                <ol className="f2-grid">
                  {tiles.filter((t) => t.section === section).map((tile) => <SlideCard key={tile.number} tile={tile} active={tile.number === active} />)}
                </ol>
              </section>
            ))}
          </div>

          {frame === 'wait' && <ProgressToast />}
          {frame === 'handoff' && <DoneToast />}
        </section>

        <aside className="f2-pane" aria-label="Review pane">
          {frame === 'layout' && <ReviewPane />}
          {frame === 'wait' && <ResearchingPane />}
          {frame === 'handoff' && <DraftedPane />}
        </aside>
      </div>
    </div>
  )
}

const stateText: Record<TileState, string> = {
  healthy: 'Notes OK',
  skip: 'Suggested skip',
  review: 'To review',
  accepted: 'Accepted',
  running: 'Researching',
  queued: 'Queued',
  needs: 'Needs notes',
}

function SlideCard({ tile, active }: { tile: Tile; active: boolean }) {
  return (
    <li className="f2-card" data-state={tile.state} data-active={active || undefined}>
      <div className="f2-card-head">
        <label className="f2-check"><input type="checkbox" readOnly checked={false} aria-label={`Select slide ${tile.number}`} /> <span className="f2-num">{tile.number}</span></label>
        {tile.hidden && <span className="f2-meta"><EyeOff size={12} aria-hidden="true" /> Hidden</span>}
      </div>
      <a className="f2-card-preview" href="#/mockups/fluent2" onClick={(e) => e.preventDefault()}>
        <span className="f2-preview-title">{tile.title}</span>
        <span className="f2-preview-text">{tile.excerpt}</span>
      </a>
      <div className="f2-card-foot">
        <StateBadge state={tile.state} />
      </div>
    </li>
  )
}

function StateBadge({ state }: { state: TileState }) {
  if (state === 'running') return <span className="f2-badge" data-tone="brand"><span className="f2-pulse" aria-hidden="true" />Researching{'\u00a0'}…</span>
  if (state === 'queued') return <span className="f2-badge" data-tone="neutral"><Clock3 size={12} aria-hidden="true" />Queued</span>
  if (state === 'healthy' || state === 'skip') return <span className="f2-quiet-state">{stateText[state]}</span>
  return <span className="f2-badge" data-tone={state === 'accepted' ? 'success' : state === 'needs' ? 'warning' : 'brand'}>{state === 'accepted' && <Check size={12} aria-hidden="true" />}{stateText[state]}</span>
}

function PaneHead({ number, title, section, badge, original = 'OK · 120 words' }: { number: number; title: string; section: string; badge: ReactNode; original?: string }) {
  return (
    <header className="f2-pane-head">
      <div className="f2-pane-nav">
        <span className="f2-breadcrumb">Storyboard <ChevronRight size={14} aria-hidden="true" /> Slide {number}</span>
        <span className="f2-iconrow">
          <button type="button" className="f2-icon" aria-label="Previous slide"><ChevronLeft size={18} /></button>
          <button type="button" className="f2-icon" aria-label="Next slide"><ChevronRight size={18} /></button>
          <button type="button" className="f2-icon" aria-label="Close review"><X size={18} /></button>
        </span>
      </div>
      <h2>{title}</h2>
      <div className="f2-pane-meta">{badge}<span>{section}</span><span>Original notes: {original}</span></div>
    </header>
  )
}

function PaneTabs({ selected = 'Draft' }: { selected?: string }) {
  return (
    <div className="f2-tabs f2-tabs-pane" role="tablist">
      {['Draft', 'Changes', 'Original notes', 'Sources (4)'].map((label) => <span key={label} role="tab" className="f2-tab" aria-selected={label === selected}>{label}</span>)}
    </div>
  )
}

function ReviewPane() {
  return (
    <>
      <PaneHead number={23} title="Public Preview: Foundry Routines in Foundry Agent Service" section="AI + machine learning" badge={<StateBadge state="review" />} />
      <PaneTabs />
      <div className="f2-pane-body">
        <div className="f2-message" data-tone="warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>Check one claim before accepting</strong>
            <p>The slide dates the public preview to 18 Sep 2026; the Foundry blog post Copilot found does not state a date.</p>
          </div>
        </div>
        <div className="f2-editor" aria-label="Draft notes, English">
          <p>Foundry Routines lets you define a repeatable sequence of agent runs inside Foundry Agent Service and trigger it on a schedule or an event, instead of wiring that orchestration yourself.</p>
          <p>Lead with the customer problem: teams already have agents that work in a chat, but the follow-up work — nightly checks, weekly summaries — still needs someone to press the button.</p>
          <p>Status is <strong>Public Preview</strong>; position it for pilots, not production commitments.</p>
        </div>
        <p className="f2-caption">Draft by Copilot · GPT-5.4 · 4 sources · English and Dutch versions</p>
      </div>
      <footer className="f2-decision">
        <p>Accepting writes these notes into the exported copy only.</p>
        <div className="f2-actions">
          <button type="button" className="f2-btn f2-btn-primary"><Check size={16} aria-hidden="true" /> Accept and continue</button>
          <button type="button" className="f2-btn">Reject</button>
          <button type="button" className="f2-btn f2-btn-subtle f2-push"><Radar size={16} aria-hidden="true" /> Research again</button>
        </div>
      </footer>
    </>
  )
}

const activity = [
  { done: true, text: 'Searched “Model router Foundry generally available”' },
  { done: true, text: 'Read learn.microsoft.com · Model router concepts' },
  { done: true, text: 'Read techcommunity.microsoft.com · announcement' },
  { done: false, text: 'Reading azure.microsoft.com · pricing' },
]

function ResearchingPane() {
  return (
    <>
      <PaneHead number={24} title="Model router in Foundry: generally available" section="AI + machine learning" badge={<StateBadge state="running" />} original="thin · 40 words" />
      <div className="f2-pane-body">
        <section className="f2-progress" role="status" aria-label="Research progress">
          <div className="f2-progress-label"><strong>Researching slide 24&nbsp;…</strong><button type="button" className="f2-btn f2-btn-small"><Square size={12} aria-hidden="true" /> Stop</button></div>
          <div className="f2-bar" aria-hidden="true"><span /></div>
          <p className="f2-caption">1:12 elapsed · usually 2–3 minutes · uses premium requests</p>
        </section>
        <ol className="f2-steps" aria-label="Research activity">
          {activity.map((step) => (
            <li key={step.text} data-done={step.done || undefined}>
              {step.done ? <Check size={14} aria-hidden="true" /> : <span className="f2-pulse" aria-hidden="true" />}
              <span>{step.done ? step.text : `${step.text}\u00a0…`}</span>
            </li>
          ))}
        </ol>
        <div className="f2-skeleton" aria-hidden="true">
          <span style={{ width: '92%' }} /><span style={{ width: '86%' }} /><span style={{ width: '64%' }} />
          <span className="f2-gap" /><span style={{ width: '90%' }} /><span style={{ width: '48%' }} />
        </div>
        <p className="f2-caption">You can keep reviewing other slides. The draft appears here when Copilot is done.</p>
        <details className="f2-disclosure"><summary>Original notes · thin · 40 words</summary></details>
      </div>
      <footer className="f2-decision">
        <div className="f2-actions">
          <button type="button" className="f2-btn" disabled>Accept and continue</button>
          <button type="button" className="f2-btn f2-btn-subtle">Write notes myself</button>
        </div>
      </footer>
    </>
  )
}

function DraftedPane() {
  return (
    <>
      <PaneHead number={24} title="Model router in Foundry: generally available" section="AI + machine learning" badge={<StateBadge state="review" />} original="thin · 40 words" />
      <PaneTabs />
      <div className="f2-pane-body">
        <p className="f2-bookend"><Check size={14} aria-hidden="true" /> Copilot drafted notes for this slide from 4 sources in 2 min 31 s.</p>
        <div className="f2-editor">
          <p>Model router picks a model per prompt based on complexity, so simple requests go to a smaller, cheaper model and harder ones to a larger model, behind one deployment.</p>
          <p>For this audience: it removes the “which model do we standardise on” debate for most workloads.</p>
        </div>
        <ol className="f2-sources">
          <li><a href="#/mockups/fluent2" onClick={(e) => e.preventDefault()}><span>Model router for Microsoft Foundry</span><small>learn.microsoft.com <ExternalLink size={12} aria-hidden="true" /></small></a></li>
          <li><a href="#/mockups/fluent2" onClick={(e) => e.preventDefault()}><span>Announcing model router general availability</span><small>techcommunity.microsoft.com <ExternalLink size={12} aria-hidden="true" /></small></a></li>
        </ol>
      </div>
      <footer className="f2-decision">
        <p>Accepting writes these notes into the exported copy only.</p>
        <div className="f2-actions">
          <button type="button" className="f2-btn f2-btn-primary"><Check size={16} aria-hidden="true" /> Accept and continue</button>
          <button type="button" className="f2-btn">Reject</button>
        </div>
      </footer>
    </>
  )
}

function ProgressToast() {
  return (
    <div className="f2-toast" role="status">
      <div className="f2-toast-head">
        <strong>Researching 3 slides&nbsp;…</strong>
        <button type="button" className="f2-btn f2-btn-subtle f2-btn-small" aria-expanded="true">Hide queue</button>
      </div>
      <div className="f2-bar" aria-hidden="true"><span /></div>
      <ol className="f2-queue">
        <li><span className="f2-pulse" aria-hidden="true" /><span className="f2-num">24</span><span className="f2-queue-title">Model router in Foundry</span><span className="f2-caption">1:12</span><button type="button" className="f2-btn f2-btn-small">Stop</button></li>
        <li><Clock3 size={14} aria-hidden="true" /><span className="f2-num">8</span><span className="f2-queue-title">Retirement: Azure Linux with OS Guard…</span><span className="f2-caption">Next</span><button type="button" className="f2-btn f2-btn-small">Remove</button></li>
        <li><Clock3 size={14} aria-hidden="true" /><span className="f2-num">22</span><span className="f2-queue-title">Foundry Agent Service: what changed…</span><span className="f2-caption">3rd</span><button type="button" className="f2-btn f2-btn-small">Remove</button></li>
      </ol>
      <p className="f2-caption">2 run in parallel across all decks. Stopping does not refund premium requests already used.</p>
    </div>
  )
}

function DoneToast() {
  return (
    <div className="f2-toast f2-toast-compact" role="status">
      <Check size={16} aria-hidden="true" className="f2-toast-icon" />
      <p>Copilot finished slide 24. The draft is ready for review.</p>
      <button type="button" className="f2-icon" aria-label="Dismiss"><X size={16} /></button>
    </div>
  )
}

function ExportFlyout() {
  return (
    <div className="f2-flyout" role="dialog" aria-label="Create enriched copy">
      <h3>Create an enriched copy</h3>
      <p>3 accepted slides will be written into a new PPTX. The original file is not changed.</p>
      <ul className="f2-flyout-list">
        <li><span className="f2-num">8</span> Retirement: Azure Linux with OS Guard…</li>
        <li><span className="f2-num">23</span> Public Preview: Foundry Routines…</li>
        <li><span className="f2-num">25</span> Azure OpenAI: regional availability…</li>
      </ul>
      <p className="f2-caption">1 slide still to review is not included.</p>
      <div className="f2-file"><FileDown size={16} aria-hidden="true" /> RMOT…-short-enriched.pptx</div>
      <div className="f2-actions">
        <button type="button" className="f2-btn f2-btn-primary">Create PPTX copy</button>
        <button type="button" className="f2-btn">Cancel</button>
      </div>
    </div>
  )
}

const notes: Record<Frame, { heading: string; items: { principle: string; href: string; today: string; proposed: string }[] }> = {
  layout: {
    heading: 'Layout and elevation',
    items: [
      { principle: 'Layout · space creates groups', href: 'https://fluent2.microsoft.design/layout', today: 'Title bar, summary strip and queue band stack ~270px before any slide; counts repeat in three places.', proposed: 'One 56px title bar. Counts live once, in the filter tabs. The queue only exists while something runs.' },
      { principle: 'Elevation · base vs. layer', href: 'https://fluent2.microsoft.design/elevation', today: 'Storyboard, tiles and review pane share one flat plane split by hairlines.', proposed: 'Tinted base layer; slide cards at shadow 4 (shadow 8 on hover); review pane as a floating panel at shadow 28.' },
      { principle: 'Cards · one container', href: 'https://fluent2.microsoft.design/components/web/react/core/card/usage', today: 'Checkbox, number and status sit outside the card, so tile edges are ambiguous.', proposed: 'Header, slide preview and status inside one card. Active = 2px brand stroke; healthy slides stay quiet text, only actionable states get a badge.' },
      { principle: 'Hierarchy · one primary', href: 'https://fluent2.microsoft.design/components/web/react/core/button/usage', today: 'Save edits and Undo acceptance look equal; the decision footer has no primary.', proposed: 'Accept and continue is the only primary in the pane; Reject secondary; Research again subtle.' },
    ],
  },
  wait: {
    heading: 'Wait UX',
    items: [
      { principle: 'Communicate clearly and honestly', href: 'https://fluent2.microsoft.design/wait-ux', today: '“Researching with Copilot” with no time expectation.', proposed: '“Researching slide 24 …” with elapsed time, the typical 2–3 minutes and a cost reminder. No fake percentage.' },
      { principle: 'Maintain context, limit simultaneous feedback', href: 'https://fluent2.microsoft.design/wait-ux', today: 'Queue band, footer connection status and pane all report state separately.', proposed: 'One progress toast for the deck, one pulsing badge per affected card, connection state in the title bar.' },
      { principle: 'Optimize perceived performance', href: 'https://fluent2.microsoft.design/wait-ux', today: 'Empty pane until the proposal lands.', proposed: 'Live activity steps (past tense when done) above a shimmering skeleton of where the draft will appear.' },
      { principle: 'Content patterns', href: 'https://fluent2.microsoft.design/wait-ux', today: 'Mixed tense and ellipsis styles.', proposed: '-ing verbs while running, past tense when done, non-breaking space before every ellipsis.' },
    ],
  },
  handoff: {
    heading: 'Handoffs',
    items: [
      { principle: 'System messages & bookends', href: 'https://fluent2.microsoft.design/handoffs', today: 'A finished research job silently flips a status.', proposed: 'Third-person, past-tense bookends: a toast on the storyboard and a matching line above the draft.' },
      { principle: 'Guide seamlessly · Create …', href: 'https://fluent2.microsoft.design/handoffs', today: '“Export 1 accepted” downloads immediately.', proposed: 'Export opens a callout (shadow 16) that previews what will be written, what is left out, and the file name. CTA: Create PPTX copy.' },
      { principle: 'Maintain context', href: 'https://fluent2.microsoft.design/handoffs', today: 'Breadcrumb is a back link only.', proposed: 'Breadcrumb Storyboard › Slide 24 plus the active card outline keep both ends of the side-by-side handoff visible.' },
    ],
  },
}

function Annotations({ frame }: { frame: Frame }) {
  const { heading, items } = notes[frame]
  return (
    <section className="f2-notes" aria-label={`${heading} annotations`}>
      <h2>{heading}: what changes</h2>
      <ul>
        {items.map((item) => (
          <li key={item.principle}>
            <a href={item.href} target="_blank" rel="noreferrer">{item.principle} <ExternalLink size={12} aria-hidden="true" /></a>
            <p><span>Today</span>{item.today}</p>
            <p><span>Proposed</span>{item.proposed}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
