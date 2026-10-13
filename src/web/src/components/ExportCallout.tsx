import { FileDown, FileText } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { SlideState } from '../api/types'
import { exportName, slideTitle } from '../lib/strip'

interface ExportCalloutProps {
  slides: SlideState[]
  fileName: string
  exporting: boolean
  disabled: boolean
  error: string | null
  onOpen: () => void
  onExport: () => Promise<unknown>
}

const listed = 6

export function ExportCallout({ slides, fileName, exporting, disabled, error, onOpen, onExport }: ExportCalloutProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const panel = useId()
  const accepted = slides.filter((s) => s.review === 'Accepted')
  const kept = slides.length - accepted.length

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!accepted.length) {
    return (
      <button type="button" className="key key-export" disabled
        aria-label="Export, available once a slide's notes are accepted" title="Accept at least one slide's notes first">
        <FileDown size={16} aria-hidden="true" />
        <span className="key-label">Export</span>
      </button>
    )
  }

  return (
    <div className="export-anchor" ref={anchor}>
      <button ref={trigger} type="button" className="key key-export" disabled={disabled}
        aria-expanded={open} aria-controls={panel} onClick={() => { if (!open) onOpen(); setOpen(!open) }}
        aria-label={`Export a copy with ${accepted.length} accepted ${accepted.length === 1 ? 'slide' : 'slides'}`}>
        <FileDown size={16} aria-hidden="true" />
        <span className="key-label">{exporting ? 'Creating copy\u00a0…' : 'Export'}</span>
        <span className="key-count">{accepted.length}</span>
      </button>
      {open && (
        <section id={panel} className="callout export-callout" role="dialog" aria-labelledby={heading}>
          <h2 id={heading}>Create an enriched copy</h2>
          <p>Accepted notes replace the speaker notes in a new file. The original deck is never changed.</p>
          <ul className="export-list">
            {accepted.slice(0, listed).map((s) => (
              <li key={s.content.number}><span>{s.content.number}</span>{slideTitle(s)}</li>
            ))}
            {accepted.length > listed && <li className="quiet">+{accepted.length - listed} more accepted</li>}
          </ul>
          {kept > 0 && <p className="quiet">{kept} other {kept === 1 ? 'slide keeps its' : 'slides keep their'} original notes.</p>}
          <p className="export-file"><FileText size={16} aria-hidden="true" />{exportName(fileName)}</p>
          {error && <p className="decision-error" role="alert">{error}</p>}
          <div className="action-row">
            <button type="button" className="key key-primary" disabled={exporting} autoFocus
              onClick={() => void onExport().then(() => setOpen(false), () => undefined)}>
              {exporting ? 'Creating copy\u00a0…' : 'Create PPTX copy'}
            </button>
            <button type="button" className="key" onClick={() => { setOpen(false); trigger.current?.focus() }}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  )
}
