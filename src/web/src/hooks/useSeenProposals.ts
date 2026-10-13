import { useCallback, useMemo } from 'react'
import { useStoredString } from './useStored'

/** Timestamp identity makes each new proposal unseen until its review is opened. */
export function useSeenProposals(deckId: string) {
  const [raw, setRaw] = useStoredString(`notes-enricher:seen:${deckId}`, '[]')

  const seen = useMemo(() => {
    try {
      return new Set(JSON.parse(raw) as string[])
    } catch {
      return new Set<string>()
    }
  }, [raw])

  const markSeen = useCallback(
    (key: string | null) => {
      if (!key || seen.has(key)) return
      setRaw(JSON.stringify([...seen, key].slice(-500)))
    },
    [seen, setRaw],
  )

  return { seen, markSeen }
}
