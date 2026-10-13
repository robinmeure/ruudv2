import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type DragEvent } from 'react'
import { api, errorMessage } from '../api/client'
import type { DeckSummary } from '../api/types'
import { copilotReady, useCopilotStatus } from '../hooks/useCopilot'
import { hrefFor, navigate } from '../hooks/useRoute'
import { notify } from '../lib/notice'
import { ConsoleBar } from './ConsoleBar'
import { CopilotLink } from './CopilotLink'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function HomeConsole() {
  const queryClient = useQueryClient()
  const decks = useQuery({ queryKey: ['decks'], queryFn: api.listDecks })
  const { data: status } = useCopilotStatus()

  const upload = useMutation({
    mutationFn: api.uploadDeck,
    onSuccess: (deck) => {
      queryClient.setQueryData(['deck', deck.id], deck)
      void queryClient.invalidateQueries({ queryKey: ['decks'] })
      navigate({ view: 'deck', deckId: deck.id, slide: null })
    },
    onError: (error) => notify(errorMessage(error), 'alert'),
  })

  const remove = useMutation({
    mutationFn: api.deleteDeck,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['decks'] }),
    onError: (error) => notify(errorMessage(error), 'alert'),
  })

  return (
    <div className="console">
      <ConsoleBar aside={<CopilotLink />} />
      <main className="home">
        <section className="home-rack" aria-labelledby="rack-heading">
          <h1 id="rack-heading" className="home-heading">
            Upload a deck, find the notes that need work, and research them with your own Copilot.
          </h1>
          <UploadSlot busy={upload.isPending} onFile={(file) => upload.mutate(file)} />

          <div className="trough home-trough">
            <h2 className="bay-heading">Your decks</h2>
            {decks.isPending && <p className="trough-note">Loading decks…</p>}
            {decks.isError && <p className="trough-note" data-tone="alert">{errorMessage(decks.error)}</p>}
            {decks.data?.length === 0 && (
              <p className="trough-note">No decks yet. The first one you drop above lands here.</p>
            )}
            <ul className="deck-list">
              {decks.data?.map((deck) => (
                <DeckRow
                  key={deck.id}
                  deck={deck}
                  deleting={remove.isPending && remove.variables === deck.id}
                  onDelete={() => remove.mutate(deck.id)}
                />
              ))}
            </ul>
          </div>
        </section>

        <aside className="home-brief" aria-label="How enrichment works">
          <h2 className="brief-heading">What happens to your deck</h2>
          <dl className="brief-list">
            <div>
              <dt>Assess</dt>
              <dd>
                Every slide’s text and speaker notes are read locally. Notes that are missing, thin, placeholder-only or
                unsourced are flagged for review.
              </dd>
            </div>
            <div>
              <dt>Research</dt>
              <dd>
                Slides you send go to your own Copilot CLI, signed in as you. It may only search and read public web
                pages; shell, file and private-network access are refused.
              </dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>Each proposal arrives with key facts, sources and warnings. Nothing changes until you accept it.</dd>
            </div>
            <div>
              <dt>Export</dt>
              <dd>Accepted notes are written into a copy. The original file is never touched.</dd>
            </div>
          </dl>
          {!copilotReady(status) && status && (
            <p className="brief-warning">
              Research is unavailable until the Copilot CLI is online and signed in. You can still upload decks and
              write notes yourself.
            </p>
          )}
        </aside>
      </main>
    </div>
  )
}

function UploadSlot({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const take = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      notify(`${file.name} is not a .pptx presentation.`, 'alert')
      return
    }
    onFile(file)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    if (!busy) take(event.dataTransfer.files)
  }

  return (
    <div
      className="upload-slot"
      data-over={over || undefined}
      data-busy={busy || undefined}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="upload-slot-holder" aria-hidden="true">
        <FileUp size={22} strokeWidth={1.75} />
      </div>
      <div className="upload-slot-text">
        <span className="upload-slot-title">{busy ? 'Reading slides…' : 'Drop a .pptx here'}</span>
        <span className="upload-slot-detail">
          {busy ? 'Reading every slide and its notes. Large decks take a few seconds.' : 'or choose one from disk. Up to 256 MB.'}
        </span>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        className="visually-hidden"
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        disabled={busy}
        onChange={(event) => {
          take(event.target.files)
          event.target.value = ''
        }}
      />
      <label htmlFor={inputId} className="key key-primary" aria-disabled={busy || undefined}>
        Choose file
      </label>
    </div>
  )
}

function DeckRow({ deck, deleting, onDelete }: { deck: DeckSummary; deleting: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="deck-row">
      <a className="deck-row-link" href={hrefFor({ view: 'deck', deckId: deck.id, slide: null })}>
        <span className="deck-row-number">
          <span className="count-value">{deck.slideCount}</span>
          <span>Slides</span>
        </span>
        <span className="deck-row-details">
          <span className="deck-row-title">{deck.title}</span>
          <span className="deck-row-sub">
            {deck.fileName} · {dateFormat.format(new Date(deck.uploadedAt))}
          </span>
        </span>
        <span className="deck-row-count">
          <span className="field-label">Flagged</span>
          <span className="count-value" data-tone={deck.flaggedCount > 0 ? 'needs' : undefined}>
            {deck.flaggedCount}
          </span>
        </span>
        <span className="deck-row-count">
          <span className="field-label">Proposals</span>
          <span className="count-value">{deck.proposalCount}</span>
        </span>
        <span className="deck-row-count">
          <span className="field-label">Accepted</span>
          <span className="count-value" data-tone={deck.acceptedCount > 0 ? 'cleared' : undefined}>
            {deck.acceptedCount}
          </span>
        </span>
      </a>
      <div className="deck-row-actions">
        {confirming ? (
          <>
            <button type="button" className="key key-alert key-small" disabled={deleting} onClick={onDelete}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button type="button" className="key key-small" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="icon-key"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${deck.fileName}`}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  )
}
