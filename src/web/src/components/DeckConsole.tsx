import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, errorMessage } from '../api/client'
import type { DeckState, ResearchQueueItem, ResearchQueueState, ReviewDecision, SlideState } from '../api/types'
import { copilotReady, modelLabel, useChosenModel, useCopilotStatus } from '../hooks/useCopilot'
import { useDeckEvents } from '../hooks/useDeckEvents'
import { hrefFor, navigate, runGuarded } from '../hooks/useRoute'
import { useSeenProposals } from '../hooks/useSeenProposals'
import { useSlideSimilarity } from '../hooks/useSlideSimilarity'
import { notify } from '../lib/notice'
import { storyboardGroups, visibleSlides, type Grouping } from '../lib/storyboard'
import { enrichableFlagged, exportName, isWorking, proposalKey, type BayFilter } from '../lib/strip'
import { ConsoleBar } from './ConsoleBar'
import { CopilotLink } from './CopilotLink'
import { ExportCallout } from './ExportCallout'
import { ResearchQueue } from './ResearchQueue'
import { Storyboard } from './Storyboard'
import { Workspace } from './Workspace'

interface DeckConsoleProps {
  deckId: string
  slide: number | null
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function DeckConsole({ deckId, slide: routeSlide }: DeckConsoleProps) {
  const queryClient = useQueryClient()
  const deckKey = useMemo(() => ['deck', deckId], [deckId])
  const deck = useQuery({ queryKey: deckKey, queryFn: () => api.getDeck(deckId), retry: 1 })
  const queueKey = useMemo(() => ['queue', deckId], [deckId])
  const queue = useQuery({
    queryKey: queueKey, queryFn: () => api.getQueue(deckId), retry: 1,
    refetchInterval: (query) => query.state.data?.items.length ? 5000 : false,
  })
  const link = useDeckEvents(deckId)
  const { data: status } = useCopilotStatus()
  const [model] = useChosenModel(status)
  const { seen, markSeen } = useSeenProposals(deckId)
  const [filter, setFilter] = useState<BayFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const previousSlide = useRef<number | null>(null)
  const main = useRef<HTMLElement>(null)
  const cancellationInFlight = useRef(false)

  const slides = useMemo(() => deck.data?.slides ?? [], [deck.data])
  const similarity = useSlideSimilarity(slides)
  const activeNumber = routeSlide ?? 0
  const active = slides.find((s) => s.content.number === activeNumber) ?? null
  const activeProposalKey = active ? proposalKey(active) : null

  const patchSlide = (slide: SlideState) =>
    queryClient.setQueryData<DeckState>(deckKey, (current) =>
      current
        ? {
            ...current,
            slides: current.slides.map((s) => (s.content.number === slide.content.number ? slide : s)),
          }
        : current,
    )

  const enrich = useMutation({
    mutationFn: (slideNumbers: number[] | null) =>
      slideNumbers && slideNumbers.length === 1
        ? api.enrichSlide(deckId, slideNumbers[0], model)
        : api.enrichDeck(deckId, slideNumbers, model),
    onSuccess: (job) => {
      setSelected(new Set())
      notify(
        job.slides.length === 0
          ? 'Nothing to send: those slides are already in research.'
          : `${job.slides.length} ${job.slides.length === 1 ? 'slide' : 'slides'} sent for research.`,
      )
      void queryClient.invalidateQueries({ queryKey: deckKey })
      void queryClient.invalidateQueries({ queryKey: queueKey })
    },
    onError: (error) => notify(errorMessage(error), 'alert'),
  })

  const cancelAll = useMutation({
    mutationFn: () => api.cancelDeck(deckId),
    onSuccess: () => {
      notify('Research cancellation requested.')
      void queryClient.invalidateQueries({ queryKey: deckKey })
      void queryClient.invalidateQueries({ queryKey: queueKey })
    },
    onError: (error) => notify(errorMessage(error), 'alert'),
    onSettled: () => { cancellationInFlight.current = false },
  })

  const cancelSlide = useMutation({
    mutationFn: ({ slideNumber, jobId }: Pick<ResearchQueueItem, 'slideNumber' | 'jobId'>) =>
      api.cancelSlide(deckId, slideNumber, jobId),
    onSuccess: (slide, item) => {
      patchSlide(slide)
      queryClient.setQueryData<ResearchQueueState>(queueKey, (current) => current ? {
        ...current,
        items: current.items.flatMap((entry) => entry.slideNumber !== item.slideNumber || entry.jobId !== item.jobId
          ? [entry] : slide.status === 'Running' ? [{ ...entry, cancellationRequested: true }] : []),
      } : current)
      notify(slide.status === 'Cancelled' ? `Slide ${item.slideNumber} removed from the queue.` : `Stopping research for slide ${item.slideNumber}.`)
    },
    onSettled: () => {
      cancellationInFlight.current = false
      void queryClient.invalidateQueries({ queryKey: deckKey })
      void queryClient.invalidateQueries({ queryKey: queueKey })
    },
    onError: (error) => notify(errorMessage(error), 'alert'),
  })

  const requestCancel = (item: Pick<ResearchQueueItem, 'slideNumber' | 'jobId'>) => {
    if (cancellationInFlight.current) return
    cancellationInFlight.current = true
    cancelSlide.mutate(item)
  }

  const requestCancelAll = () => {
    if (cancellationInFlight.current) return
    cancellationInFlight.current = true
    cancelAll.mutate()
  }

  const review = useMutation({
    mutationFn: ({ number, decision, notes }: { number: number; decision: ReviewDecision; notes?: string }) =>
      api.review(deckId, number, decision, notes),
    onSuccess: (slide, { decision }) => {
      patchSlide(slide)
      void queryClient.invalidateQueries({ queryKey: ['decks'] })
      notify(decision === 'accepted' ? `Slide ${slide.content.number} saved for export.` : decision === 'rejected' ? `Slide ${slide.content.number} proposal rejected.` : `Slide ${slide.content.number} decision undone.`)
    },
    onError: (error) => notify(errorMessage(error), 'alert'),
  })

  const exportDeck = useMutation({
    mutationFn: async (fileName: string) => ({ blob: await api.exportDeck(deckId), fileName }),
    onSuccess: ({ blob, fileName }) => {
      const url = URL.createObjectURL(blob)
      const download = document.createElement('a')
      download.href = url
      download.download = exportName(fileName)
      document.body.append(download)
      download.click()
      download.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify(`Notes Enricher created ${exportName(fileName)}. Your original deck was not changed.`)
    },
  })

  useEffect(() => {
    if (active?.review === 'Pending') markSeen(activeProposalKey)
  }, [active?.review, activeProposalKey, markSeen])

  const [grouping, setGrouping] = useState<Grouping>('section')
  const filtered = useMemo(() => visibleSlides(slides, filter, search), [slides, filter, search])
  const groups = useMemo(() => storyboardGroups(filtered, grouping, similarity.analysis), [filtered, grouping, similarity.analysis])
  const visible = useMemo(() => groups.flatMap((g) => g.slides), [groups])
  const visibleNumbers = useMemo(() => visible.map((s) => s.content.number), [visible])

  useEffect(() => {
    if (routeSlide !== null) previousSlide.current = routeSlide
    else if (previousSlide.current !== null) {
      main.current?.querySelector<HTMLAnchorElement>(`a[href="${hrefFor({ view: 'deck', deckId, slide: previousSlide.current })}"]`)?.focus({ preventScroll: true })
    }
  }, [routeSlide, deckId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isTyping(event.target) || document.querySelector('dialog[open]')) return
      const key = event.key.toLowerCase()
      if (key !== 'j' && key !== 'k') return
      if (visibleNumbers.length === 0) return
      event.preventDefault()
      const index = visibleNumbers.indexOf(activeNumber)
      const nextIndex =
        index === -1 ? 0 : Math.min(visibleNumbers.length - 1, Math.max(0, index + (key === 'j' ? 1 : -1)))
      navigate({ view: 'deck', deckId, slide: visibleNumbers[nextIndex] }, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleNumbers, activeNumber, deckId])

  if (deck.isPending) {
    return (
      <div className="console">
        <ConsoleBar aside={<CopilotLink />} />
        <main className="deck-loading">
          <p className="trough-note" role="status">Loading slides…</p>
        </main>
      </div>
    )
  }

  if (deck.isError) {
    const gone = deck.error instanceof ApiError && deck.error.status === 404
    return (
      <div className="console">
        <ConsoleBar aside={<CopilotLink />} />
        <main className="deck-loading">
          <p className="trough-note" data-tone="alert">
            {gone ? 'This deck is no longer available.' : errorMessage(deck.error)}
          </p>
          <a className="key" href={hrefFor({ view: 'home' })}>
            Back to all decks
          </a>
          {!gone && <button type="button" className="key" onClick={() => void deck.refetch()}>Retry loading deck</button>}
        </main>
      </div>
    )
  }

  const data = deck.data
  const acceptedCount = slides.filter((s) => s.review === 'Accepted').length
  const ready = copilotReady(status)
  const modelName = modelLabel(status, model)
  const activeIndex = active ? slides.indexOf(active) : -1

  return (
    <div className="console deck-console">
      <ConsoleBar
        aside={
          <>
            <span role="status" className="link-state" data-state={link}>
              {link !== 'live' && <span className="lamp" aria-hidden="true" />}
              <span className={link === 'live' ? 'visually-hidden' : undefined}>
                {link === 'live' ? 'Live updates connected' : link === 'connecting' ? 'Connecting live updates\u00a0…' : 'Connection lost. Reconnecting\u00a0…'}
              </span>
            </span>
            {link === 'lost' && <button type="button" className="key key-small" onClick={() => { void deck.refetch(); void queue.refetch() }}>Refresh deck</button>}
            <CopilotLink />
            <ExportCallout slides={slides} fileName={data.fileName} exporting={exportDeck.isPending}
              disabled={exportDeck.isPending || review.isPending}
              error={exportDeck.isError ? errorMessage(exportDeck.error) : null}
              onOpen={() => exportDeck.reset()}
              onExport={() => exportDeck.mutateAsync(data.fileName)} />
          </>
        }
      >
        <div className="deck-ident">
          <h1 className="deck-title">{data.title}</h1>
          <span className="deck-file">
            {data.fileName} · {slides.length} slides
          </span>
        </div>
      </ConsoleBar>

      <span className="visually-hidden" role="status">{acceptedCount} accepted. {slides.filter((s) => s.review === 'Pending').length} proposals to review. {slides.filter(isWorking).length} in research. {slides.filter((s) => s.status === 'Failed').length} research failures.</span>
      <ResearchQueue
        deckId={deckId} slides={slides} queue={queue.data} loading={queue.isPending}
        error={queue.isError ? errorMessage(queue.error) : null}
        onRetry={() => void queue.refetch()}
        cancellingSlide={cancelSlide.isPending ? cancelSlide.variables.slideNumber : null}
        cancellingAll={cancelAll.isPending}
        onCancel={requestCancel} onCancelAll={requestCancelAll}
      />
      <main ref={main} className="deck-main" data-open={routeSlide !== null || undefined}>
        <Storyboard
          deckId={deckId}
          slides={slides}
          visible={visible}
          groups={groups}
          grouping={similarity.analysis ? grouping : 'section'}
          onGrouping={setGrouping}
          similarity={similarity}
          activeNumber={activeNumber}
          filter={filter}
          onFilter={setFilter}
          search={search}
          onSearch={setSearch}
          selected={selected}
          onSelectionChange={setSelected}
          seen={seen}
          ready={ready}
          modelName={modelName}
          enriching={enrich.isPending}
          onEnrich={(numbers) => {
            const affected = numbers ?? enrichableFlagged(slides).map((s) => s.content.number)
            if (affected.includes(activeNumber)) runGuarded(() => enrich.mutate(affected))
            else enrich.mutate(affected)
          }}
        />

        {active ? (
          <Workspace
            key={active.content.number}
            deckId={deckId}
            slide={active}
            slides={slides}
            similarity={similarity}
            prev={slides[activeIndex - 1] ?? null}
            next={slides[activeIndex + 1] ?? null}
            ready={ready}
            modelName={modelName}
            enriching={enrich.isPending}
            reviewing={review.isPending}
            cancelPending={cancelSlide.isPending || cancelAll.isPending}
            cancelling={cancelAll.isPending || (cancelSlide.isPending && cancelSlide.variables.slideNumber === activeNumber)}
            filteredOut={!visibleNumbers.includes(activeNumber)}
            onReveal={() => { setSearch(''); setFilter('all') }}
            onEnrich={() => enrich.mutate([active.content.number])}
            onCancel={() => {
              if (active.jobId) requestCancel({ slideNumber: active.content.number, jobId: active.jobId })
              else notify('This slide has no active research job. Refresh the deck.', 'alert')
            }}
            onReview={(decision, notes) => review.mutateAsync({ number: active.content.number, decision, notes })}
          />
        ) : (
          <section className="workspace workspace-empty">
            <h2>{routeSlide === null ? 'Choose a slide to review' : `Slide ${routeSlide} is not in this deck`}</h2>
            <p>{routeSlide === null ? 'Open a content preview to read the original notes, review a proposal, or write your own.' : 'Return to the storyboard to choose an available slide.'}</p>
            {routeSlide !== null && <a className="key" href={hrefFor({ view: 'deck', deckId, slide: null })}>Back to storyboard</a>}
          </section>
        )}
      </main>
    </div>
  )
}
