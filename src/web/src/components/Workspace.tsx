import { ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, Radar, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReviewDecision, SlideState } from '../api/types'
import type { SlideSimilarity } from '../hooks/useSlideSimilarity'
import { hrefFor, runGuarded } from '../hooks/useRoute'
import { classifyActivity, hostOf, isWorking, languageLabel, notesLabels, slideTitle, splitActivity, stateLabel, type ActivityKind } from '../lib/strip'
import { NotesDesk } from './NotesDesk'
import { SimilarSlides } from './SimilarSlides'

interface WorkspaceProps {
  deckId: string
  slide: SlideState
  slides: SlideState[]
  similarity: SlideSimilarity
  prev: SlideState | null
  next: SlideState | null
  ready: boolean
  modelName: string
  enriching: boolean
  reviewing: boolean
  cancelling: boolean
  cancelPending: boolean
  filteredOut: boolean
  onReveal: () => void
  onEnrich: () => void
  onCancel: () => void
  onReview: (decision: ReviewDecision, notes?: string) => Promise<SlideState>
}

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function Workspace(props: WorkspaceProps) {
  const { deckId, slide, prev, next } = props
  const { content, assessment } = slide
  const [confirming, setConfirming] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)
  const working = isWorking(slide)
  useEffect(() => { title.current?.focus({ preventScroll: true }) }, [])

  return (
    <section className="workspace" aria-label={`Review slide ${content.number}`}>
      <header className="review-head">
        <div className="review-navigation">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <a className="review-back" href={hrefFor({ view: 'deck', deckId, slide: null })}><ArrowLeft size={14} aria-hidden="true" /> Storyboard</a>
            <ChevronRight size={12} aria-hidden="true" />
            <span aria-current="page">Slide {content.number}</span>
          </nav>
          <div className="action-row icon-row">
            {prev && <a className="icon-key" href={hrefFor({ view: 'deck', deckId, slide: prev.content.number })} aria-label={`Previous slide: ${prev.content.number}`}><ChevronLeft size={18} /></a>}
            {next && <a className="icon-key" href={hrefFor({ view: 'deck', deckId, slide: next.content.number })} aria-label={`Next slide: ${next.content.number}`}><ChevronRight size={18} /></a>}
            <a className="icon-key" href={hrefFor({ view: 'deck', deckId, slide: null })} aria-label="Close review"><X size={18} /></a>
          </div>
        </div>
        <h2 ref={title} tabIndex={-1}>{slideTitle(slide)}</h2>
        <div className="review-meta">
          {content.section && <span>{content.section}</span>}
          <span className="workflow-state" data-status={slide.status} data-review={slide.review}>{stateLabel(slide)}</span>
          <details className="assessment-details">
            <summary>Notes: {notesLabels[assessment.notesStatus]} · {assessment.notesWordCount} words{assessment.flagged ? ' · flagged' : ''}</summary>
            <ul>
              {content.hidden && <li>Hidden in the slide show.</li>}
              {assessment.suggestSkip && <li>{assessment.kind} slide; research is suggested to skip.</li>}
              {assessment.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
              <li>Sources in original notes: {assessment.notesHaveSources ? 'yes' : 'none'}. {assessment.timeSensitive ? 'Contains time-sensitive content.' : ''}</li>
            </ul>
          </details>
        </div>
        {props.filteredOut && <p className="operational-note">This slide is outside the current results. <button type="button" className="text-button" onClick={props.onReveal}>Reveal in storyboard</button></p>}
        {working ? (
          <ResearchProgress slide={slide} cancelPending={props.cancelPending} cancelling={props.cancelling} onCancel={props.onCancel} />
        ) : (
          <div className="review-research">
            <button type="button" className="key key-small" disabled={!props.ready || props.enriching || props.reviewing} onClick={() => setConfirming(true)}>
              <Radar size={15} aria-hidden="true" />{props.enriching ? 'Sending…' : slide.status === 'Failed' ? 'Retry research' : slide.proposal ? 'Research again' : 'Research this slide'}
            </button>
            {!props.ready && <span className="quiet">Copilot is unavailable.</span>}
          </div>
        )}
        {confirming && !working && (
          <div className="research-confirm">
            <p>Research with <strong>{props.modelName}</strong> uses Copilot premium requests{slide.proposal ? ' and replaces this proposal' : ''}.</p>
            <div className="action-row">
              <button type="button" className="key key-primary key-small" disabled={!props.ready || props.enriching || props.reviewing} onClick={() => runGuarded(() => { setConfirming(false); props.onEnrich() })}>Start research</button>
              <button type="button" className="key key-small" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        )}
        {slide.status === 'Failed' && <p className="decision-error" role="alert">Research failed: {slide.error || 'No details were returned.'} Retry when Copilot is available.</p>}
        {slide.status === 'Cancelled' && <p className="operational-note">Research was cancelled. You can research again or write notes.</p>}
      </header>
      <NotesDesk slide={slide} reviewing={props.reviewing} onReview={props.onReview}>
        <ResearchDetails slide={slide} />
        <SimilarSlides deckId={deckId} slideNumber={content.number} slides={props.slides} similarity={props.similarity} />
        <SlideText slide={slide} />
        <ActivityLog slide={slide} />
      </NotesDesk>
    </section>
  )
}

const recentSteps = 8

const kindLabels: Record<ActivityKind, string> = { thinking: 'Thinking', plan: 'Plan', result: 'Result', problem: '', step: '' }

function ActivityText({ line, full }: { line: string; full?: boolean }) {
  const { kind, text } = classifyActivity(line)
  return (
    <span className="activity-text" data-kind={kind} data-full={full || undefined}>
      {kindLabels[kind] && <b className="activity-tag">{kindLabels[kind]}</b>}
      {text}
    </span>
  )
}

/** Honest wait state: indeterminate progress, real activity lines, no invented percentages or durations. */
function ResearchProgress({ slide, cancelPending, cancelling, onCancel }: {
  slide: SlideState; cancelPending: boolean; cancelling: boolean; onCancel: () => void
}) {
  const queued = slide.status === 'Queued'
  const stopping = slide.cancellationRequested
  const steps = slide.activity.slice(-recentSteps).map(splitActivity)
  const started = slide.activity.length ? splitActivity(slide.activity[0]).time : ''
  const label = stopping ? 'Stopping research\u00a0…' : queued ? 'Queued for research' : `Researching slide ${slide.content.number}\u00a0…`
  return (
    <div className="research-progress" data-queued={queued || undefined}>
      <div className="progress-label">
        <p className="working-note">{!queued && <span className="pulse" aria-hidden="true" />}{label}</p>
        <button type="button" className="key key-small" disabled={cancelPending || stopping || !slide.jobId} onClick={onCancel}>
          <Square size={13} aria-hidden="true" />{cancelling || stopping ? queued ? 'Removing…' : 'Stopping…' : queued ? 'Remove from queue' : 'Stop this slide'}
        </button>
      </div>
      {!queued && <div className="progress-bar" aria-hidden="true"><span /></div>}
      <p className="quiet">{queued ? 'Starts when a research worker is free.' : started ? `Started ${started} · uses Copilot premium requests` : 'Uses Copilot premium requests'}</p>
      {!queued && steps.length > 0 && (
        <ol className="progress-steps" aria-label="Latest research activity">
          {steps.map((step, index) => {
            const current = index === steps.length - 1
            return (
              <li key={`${slide.activity.length}-${index}`} data-done={!current || undefined}>
                {current ? <span className="pulse" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                <ActivityText line={step.text} />
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function ResearchDetails({ slide }: { slide: SlideState }) {
  const proposal = slide.proposal
  if (!proposal) return null
  return (
    <section className="research-details" aria-label="Proposal provenance">
      <h3>Research details</h3>
      <dl className="proposal-metadata">
        <div><dt>Model</dt><dd>{proposal.model || 'Not supplied'}</dd></div>
        <div><dt>Proposal created</dt><dd><time dateTime={proposal.createdAt}>{timeFormat.format(new Date(proposal.createdAt))}</time></dd></div>
        <div><dt>Language</dt><dd>{languageLabel(proposal.language)}</dd></div>
        <div><dt>Model-reported confidence</dt><dd>{proposal.confidence || 'Not supplied'} <span className="quiet">(not calibrated certainty)</span></dd></div>
      </dl>
      <h4>Key facts</h4>
      {proposal.keyFacts.length ? <ul className="fact-list">{proposal.keyFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul> : <p className="quiet">No key facts were returned.</p>}
      <h4>Sources</h4>
      {proposal.sources.length ? (
        <ol className="source-list">{proposal.sources.map((source, index) => <li key={`${index}:${source.url}`}>
          <a href={source.url} target="_blank" rel="noreferrer"><span>{source.title || hostOf(source.url)}</span><small>{hostOf(source.url)} <ExternalLink size={12} aria-hidden="true" /></small></a>
        </li>)}</ol>
      ) : <p className="quiet">No public sources were returned.</p>}
    </section>
  )
}

function SlideText({ slide }: { slide: SlideState }) {
  const { content } = slide
  return (
    <details className="slide-content">
      <summary>Extracted slide content</summary>
      <p className="quiet">{content.pictureCount} images · {content.chartCount} charts · {content.tables.length} tables. This is not a rendered slide.</p>
      {content.paragraphs.length ? <ul className="slide-paragraphs">{content.paragraphs.map((paragraph, index) => <li key={index}>{paragraph.text}</li>)}</ul> : <p>No body text was extracted.</p>}
      {content.tables.map((table, index) => <div className="slide-table-wrap" key={index}><table><tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div>)}
      {[...content.chartTitles, ...content.pictureDescriptions].map((text, index) => <p key={index}>{text}</p>)}
      {content.links.length > 0 && <ul className="slide-links">{content.links.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>}
    </details>
  )
}

function ActivityLog({ slide }: { slide: SlideState }) {
  const latest = slide.activity.at(-1)
  return (
    <section className="research-activity" aria-label="Research activity">
      <h3>Research activity</h3>
      <p className="latest-activity">{latest ? classifyActivity(splitActivity(latest).text).text : isWorking(slide) ? 'Waiting for the first activity…' : 'No research activity yet.'}</p>
      {slide.activity.length > 0 && <details><summary>Activity log ({slide.activity.length})</summary>
        <ol className="log-lines">{slide.activity.map((line, index) => {
          const { time, text } = splitActivity(line)
          return <li key={index}><time>{time}</time><ActivityText line={text} full /></li>
        })}</ol>
      </details>}
    </section>
  )
}
