import { PanelsTopLeft, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { hrefFor } from '../hooks/useRoute'
import { dismissNotice, useNotice } from '../lib/notice'

interface ConsoleBarProps {
  children?: ReactNode
  aside?: ReactNode
}

export function ConsoleBar({ children, aside }: ConsoleBarProps) {
  const notice = useNotice()

  return (
    <header className="console-bar">
      <a className="wordmark" href={hrefFor({ view: 'home' })} aria-label="Notes Enricher, all decks">
        <PanelsTopLeft size={23} aria-hidden="true" />
        <span>Notes Enricher</span>
      </a>
      <div className="console-bar-main">{children}</div>
      <div className="console-bar-aside">{aside}</div>
      <div className="notice-slot" role="status" aria-live="polite">
        {notice && (
          <div className="notice" data-tone={notice.tone} key={notice.id}>
            <span>{notice.text}</span>
            <button type="button" className="icon-key" onClick={dismissNotice} aria-label="Dismiss message">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
