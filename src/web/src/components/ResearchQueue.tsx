import { useEffect, useState } from 'react'
import type { ResearchQueueItem, ResearchQueueState, SlideState } from '../api/types'
import { hrefFor } from '../hooks/useRoute'
import { slideTitle } from '../lib/strip'

interface ResearchQueueProps {
  deckId: string
  slides: SlideState[]
  queue: ResearchQueueState | undefined
  loading: boolean
  error: string | null
  cancellingSlide: number | null
  cancellingAll: boolean
  onCancel: (item: ResearchQueueItem) => void
  onCancelAll: () => void
  onRetry: () => void
}

const shortViewport = '(max-height: 600px)'

export function ResearchQueue(props: ResearchQueueProps) {
  const [expanded, setExpanded] = useState(() => !window.matchMedia(shortViewport).matches)
  useEffect(() => {
    const media = window.matchMedia(shortViewport)
    const onChange = () => setExpanded(!media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const items = props.queue?.items ?? []
  if (!props.loading && !props.error && !items.length) return null
  const running = items.filter((item) => item.status === 'Running')
  const waiting = items.filter((item) => item.status === 'Queued')
  const busy = props.cancellingAll || props.cancellingSlide !== null
  const slides = new Map(props.slides.map((slide) => [slide.content.number, slide]))

  const headline = running.length
    ? `Researching ${running.length} ${running.length === 1 ? 'slide' : 'slides'}\u00a0…`
    : waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'slide' : 'slides'} waiting for research` : 'Research queue'

  return (
    <section className="research-queue" aria-label="Research queue">
      <header className="queue-heading">
        <div className="queue-title">
          {running.length > 0 && <span className="pulse" aria-hidden="true" />}
          <div>
            <h2>{headline}</h2>
            <p>{running.length} running · {waiting.length} queued</p>
          </div>
        </div>
        <div className="action-row">
          <button className="key key-small key-quiet" type="button" aria-expanded={expanded} aria-controls="research-queue-items" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide queue' : 'Show queue'}</button>
          {items.length > 0 && <button className="key key-small" type="button" disabled={busy} onClick={props.onCancelAll}>{props.cancellingAll ? 'Stopping…' : `Stop all (${items.length})`}</button>}
        </div>
      </header>
      {running.length > 0 && <div className="progress-bar" aria-hidden="true"><span /></div>}
      {props.loading && <p className="queue-message" role="status">Loading research queue&nbsp;…</p>}
      {props.error && <p className="queue-message decision-error" role="alert">Could not refresh the queue: {props.error} <button className="text-button" type="button" onClick={props.onRetry}>Retry queue</button></p>}
      <div id="research-queue-items" hidden={!expanded}>
        <div className="queue-groups">
          {(['Running', 'Queued'] as const).map((status) => {
            const group = status === 'Running' ? running : waiting
            return (
              <section className="queue-group" key={status} aria-label={`${status} slides`}>
                <h3>{status} ({group.length})</h3>
                {group.length ? <ol>
                  {group.map((item) => {
                    const slide = slides.get(item.slideNumber)
                    const pending = item.cancellationRequested || props.cancellingAll || props.cancellingSlide === item.slideNumber
                    return (
                      <li className="queue-item" key={`${item.jobId}:${item.slideNumber}`}>
                        <a href={hrefFor({ view: 'deck', deckId: props.deckId, slide: item.slideNumber })}>
                          <span className={status === 'Running' ? 'pulse' : 'queue-dot'} aria-hidden="true" />
                          <strong>{item.slideNumber}</strong>
                          <span className="queue-item-title">{slide ? slideTitle(slide) : `Slide ${item.slideNumber}`}</span>
                        </a>
                        <button className="key key-small key-quiet" type="button" disabled={busy || item.cancellationRequested}
                          aria-label={status === 'Queued' ? `Remove slide ${item.slideNumber} from queue` : `Stop research for slide ${item.slideNumber}`}
                          onClick={() => props.onCancel(item)}>
                          {pending ? status === 'Queued' ? 'Removing…' : 'Stopping…' : status === 'Queued' ? 'Remove' : 'Stop'}
                        </button>
                      </li>
                    )
                  })}
                </ol> : <p className="quiet">{status === 'Queued' ? 'No slides waiting.' : 'No slides running in this deck.'}</p>}
              </section>
            )
          })}
        </div>
        <p className="queue-message quiet">{props.queue && <><span>Up to {props.queue.maxConcurrency} slides in parallel, shared across all decks.</span> </>}Queued slides start in submission order as workers become free. Stopping a running slide does not undo premium requests already used.</p>
      </div>
    </section>
  )
}
