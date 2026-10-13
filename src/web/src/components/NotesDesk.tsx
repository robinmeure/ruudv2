import { diffWords } from 'diff'
import { Check, PencilLine, Sparkles, TriangleAlert, Undo2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { errorMessage } from '../api/client'
import type { ReviewDecision, SlideState } from '../api/types'
import { registerNavigationGuard, runGuarded } from '../hooks/useRoute'
import { bilingualWordCounts, countWords, isWorking, singleLanguageTag, splitBilingual, wordBudgetPerLanguage, type NotesLanguage } from '../lib/strip'

interface NotesDeskProps {
  slide: SlideState
  reviewing: boolean
  onReview: (decision: ReviewDecision, notes?: string) => Promise<SlideState>
  children?: ReactNode
}

function editorFor(slide: SlideState) {
  const notes = slide.review === 'Accepted' ? (slide.acceptedNotes ?? '') : (slide.proposal?.notes ?? '')
  return { source: JSON.stringify([slide.review, slide.acceptedNotes, slide.proposal?.createdAt, slide.proposal?.notes]), base: notes, draft: notes }
}

const maxWords = 250
const languageBudget = wordBudgetPerLanguage(maxWords)

export function NotesDesk({ slide, reviewing, onReview, children }: NotesDeskProps) {
  const latest = editorFor(slide)
  const [editor, setEditor] = useState(latest)
  const [manual, setManual] = useState(false)
  const [view, setView] = useState<'draft' | 'changes' | 'original'>('draft')
  const [language, setLanguage] = useState<NotesLanguage>('english')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<ReviewDecision | null>(null)
  const [navigation, setNavigation] = useState<{ proceed: () => void; allowSave: boolean } | null>(null)
  const submitting = useRef(false)
  const draftId = useId()
  const dirty = editor.draft !== editor.base
  const busy = reviewing || pending !== null
  const working = isWorking(slide)
  const accepted = slide.review === 'Accepted'
  const rejected = slide.review === 'Rejected'
  const editing = accepted || slide.proposal !== null || manual
  const words = countWords(editor.draft)
  const perLanguage = bilingualWordCounts(editor.draft)
  const overBudget = perLanguage ? perLanguage.english > languageBudget || perLanguage.dutch > languageBudget : words > maxWords
  const heading = accepted ? 'Accepted notes' : slide.proposal ? 'Proposed notes' : 'Your notes'
  const bilingual = splitBilingual(editor.draft)
  const valid = bilingual ? bilingual.english.trim().length > 0 && bilingual.dutch.trim().length > 0 : editor.draft.trim().length > 0
  const flagged = slide.proposal !== null && (slide.proposal.warnings.length > 0 || slide.proposal.sources.length === 0)
  const serverChanged = editor.source !== latest.source

  if (serverChanged && !dirty && !manual && !busy) setEditor(latest)

  useEffect(() => {
    if (!dirty && !busy) return
    const unregister = registerNavigationGuard((proceed, allowSave) => setNavigation({ proceed, allowSave }))
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { unregister(); window.removeEventListener('beforeunload', beforeUnload) }
  }, [dirty, busy])

  const submit = async (decision: ReviewDecision): Promise<boolean> => {
    if (submitting.current || busy || working) return false
    submitting.current = true
    setPending(decision)
    setError(null)
    try {
      const saved = await onReview(decision, decision === 'accepted' ? editor.draft : undefined)
      setEditor(editorFor(saved))
      setManual(false)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      submitting.current = false
      setPending(null)
    }
  }

  const discard = () => { setEditor(latest); setManual(false); setError(null) }

  return (
    <div className="notes-desk">
      <div className="review-scroll">
        <section className="notes-section" aria-label="Speaker notes">
          <div className="view-toggle" role="group" aria-label="Notes view">
            <button type="button" aria-pressed={view === 'draft'} onClick={() => setView('draft')}>{heading}</button>
            <button type="button" aria-pressed={view === 'changes'} onClick={() => setView('changes')}>Changes</button>
            <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>Original notes</button>
            {editing && <span className="draft-state" data-dirty={dirty || undefined}>{dirty ? 'Unsaved edits' : accepted ? 'Saved for export' : rejected ? 'Rejected proposal' : 'Not accepted'}</span>}
          </div>
          {view === 'draft' && slide.proposal && (
            <p className="bookend">
              <Sparkles size={14} aria-hidden="true" />
              <span>Copilot drafted {slide.review === 'Accepted' ? 'the proposal' : 'these notes'} from {slide.proposal.sources.length} public {slide.proposal.sources.length === 1 ? 'source' : 'sources'}. Generated notes need your review; source links show provenance, not independent verification.</span>
            </p>
          )}
          {view === 'draft' && slide.proposal && flagged && (
            <div className="draft-warnings">
              <h3><TriangleAlert size={16} aria-hidden="true" /> Check before accepting</h3>
              <ul>
                {slide.proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                {slide.proposal.sources.length === 0 && <li>No public sources were returned. Treat this proposal with care.</li>}
              </ul>
            </div>
          )}
          {serverChanged && (dirty || manual) && !busy && (
            <div className="draft-warnings">
              <p>The saved proposal or decision changed. Your local draft has been kept.</p>
              <button type="button" className="key key-small" onClick={() => runGuarded(discard)}>Discard edits and load latest</button>
            </div>
          )}
          {view === 'original' ? (
            <div className="notes-original">
              <h3>In the original deck</h3>
              <p className="notes-text">{slide.content.notes || (slide.content.hasNotesPart ? 'The notes page is empty.' : 'This slide has no speaker notes.')}</p>
            </div>
          ) : !editing ? (
            <div className="empty-state">
              <h3>{working ? 'Research in progress' : 'No proposal yet'}</h3>
              <p>{working ? 'The proposal will appear here when research finishes.' : 'Research this slide or write the speaker notes yourself.'}</p>
              {working && <div className="skeleton" aria-hidden="true"><span /><span /><span /><i /><span /><span /></div>}
              {!working && <button type="button" className="key" onClick={() => {
                setEditor({ ...latest, base: slide.content.notes, draft: slide.content.notes })
                setManual(true)
                setView('draft')
              }}><PencilLine size={16} aria-hidden="true" /> Write notes yourself</button>}
            </div>
          ) : view === 'changes' ? (
            <div>
              <p className="diff-legend"><ins>Added</ins> · <del>Removed</del> compared with the original notes</p>
              <p className="notes-text notes-diff" aria-label="Changes against original notes">
                {diffWords(slide.content.notes, editor.draft).map((part, index) => part.added ? <ins key={index}>{part.value}</ins> : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}
              </p>
            </div>
          ) : (
            <>
              {bilingual && (
                <div className="language-toggle" role="group" aria-label="Notes language">
                  <button type="button" aria-pressed={language === 'english'} onClick={() => setLanguage('english')}>English</button>
                  <button type="button" aria-pressed={language === 'dutch'} onClick={() => setLanguage('dutch')}>Dutch</button>
                  <span>Both languages are saved and exported.</span>
                </div>
              )}
              <textarea id={draftId} aria-label={bilingual ? `${heading}, ${language === 'english' ? 'English' : 'Dutch'}` : heading} className="notes-editor"
                value={bilingual ? bilingual[language] : editor.draft}
                onChange={(event) => setEditor({ ...editor, draft: bilingual ? bilingual.compose(language, event.target.value) : event.target.value })}
                readOnly={busy || working} spellCheck lang={bilingual ? (language === 'english' ? 'en' : 'nl') : singleLanguageTag(slide.proposal?.language)} />
              <p className="word-budget" data-over={overBudget || undefined}>
                {perLanguage ? `EN ${perLanguage.english} · NL ${perLanguage.dutch} words. Guidance: ${languageBudget} each.` : `${words} words. Guidance: ${maxWords} words.`}
                {overBudget && ' Longer notes can still be accepted.'}
              </p>
            </>
          )}
        </section>
        {children}
      </div>
      <footer className="review-decisions">
        {error && <p className="decision-error" role="alert">{error} Your draft is still here. Retry the action below.</p>}
        {flagged && <p className="decision-warning"><TriangleAlert size={15} aria-hidden="true" /> Review the warnings {view === 'draft' ? 'above' : `on the ${heading} tab`} before accepting.</p>}
        {editing && !working ? (
          <>
            <div className="action-row">
              <button type="button" className="key key-primary" disabled={!valid || busy || (accepted && !dirty)}
                onClick={() => void submit('accepted')}>
                <Check size={16} aria-hidden="true" />{pending === 'accepted' ? 'Saving…' : accepted ? 'Save edits' : rejected ? 'Accept anyway' : 'Accept notes'}
              </button>
              {accepted ? (
                <button type="button" className="key" disabled={busy} onClick={() => runGuarded(() => void submit('pending'))}><Undo2 size={15} aria-hidden="true" /> Undo acceptance</button>
              ) : slide.proposal ? (
                <button type="button" className="key" disabled={busy} onClick={() => runGuarded(() => void submit(rejected ? 'pending' : 'rejected'))}>
                  {rejected ? <Undo2 size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}{pending === 'rejected' ? 'Rejecting…' : rejected ? 'Undo rejection' : 'Reject'}
                </button>
              ) : <button type="button" className="key" disabled={busy} onClick={() => runGuarded(discard)}>Discard manual notes</button>}
            </div>
            <p className="decision-caption">{accepted ? 'Only saved edits are included in export.' : 'Accepting saves these notes for the exported copy.'}</p>
          </>
        ) : <p className="decision-caption">{working ? 'Wait for research to finish before reviewing.' : 'The original deck is never changed.'}</p>}
      </footer>
      {navigation && (
        <UnsavedDialog busy={busy} canSave={navigation.allowSave && dirty && valid && !working} accepted={accepted} error={error}
          onStay={() => setNavigation(null)}
          onDiscard={() => { discard(); setNavigation(null); navigation.proceed() }}
          onSave={() => { void submit('accepted').then((saved) => { if (saved) { setNavigation(null); navigation.proceed() } }) }} />
      )}
    </div>
  )
}

function UnsavedDialog({ busy, canSave, accepted, error, onStay, onDiscard, onSave }: {
  busy: boolean; canSave: boolean; accepted: boolean; error: string | null
  onStay: () => void; onDiscard: () => void; onSave: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog ref={dialog} className="unsaved-dialog" aria-labelledby={heading} onCancel={(event) => { event.preventDefault(); if (!busy) onStay() }}>
      <h2 id={heading}>{busy ? 'Saving your decision…' : 'Keep your note edits?'}</h2>
      <p>{busy ? 'Wait for the server to confirm before leaving.' : 'Stay to continue editing, or discard your local edits and continue.'}</p>
      {!accepted && canSave && <p>Accept and continue saves these notes for export. It does not save a private draft.</p>}
      {error && <p className="decision-error" role="alert">{error} Your edits have not been discarded.</p>}
      <div className="action-row">
        <button type="button" className="key" autoFocus onClick={onStay} disabled={busy}>Stay</button>
        <button type="button" className="key" onClick={onDiscard} disabled={busy}>Discard and continue</button>
        {canSave && <button type="button" className="key key-primary" onClick={onSave} disabled={busy}>{accepted ? 'Save and continue' : 'Accept and continue'}</button>}
      </div>
    </dialog>
  )
}
