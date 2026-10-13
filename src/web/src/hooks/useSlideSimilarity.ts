import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SlideState } from '../api/types'
import { embedTexts, isModelLoaded, readCached, type EmbedProgress } from '../lib/embeddings'
import { analyzeDeck, deckTexts, textsToEmbed, type DeckAnalysis, type SlideTexts } from '../lib/similarity'
import { slideTitle } from '../lib/strip'

export type SimilarityStatus = 'checking' | 'idle' | 'running' | 'ready' | 'error'

export interface SlideSimilarity {
  status: SimilarityStatus
  progress: EmbedProgress | null
  error: string | null
  /** Distinct texts that still need an embedding. */
  missing: number
  /** True when some vectors exist, so partial results can be shown. */
  partial: boolean
  /** Deck-wide matches, duplicate groups and topics; null until any vectors exist. */
  analysis: DeckAnalysis | null
  run: () => void
  textsFor: (slideNumber: number) => SlideTexts | undefined
}

export function useSlideSimilarity(slides: SlideState[]): SlideSimilarity {
  const texts = useMemo(() => deckTexts(slides), [slides])
  const needed = useMemo(() => textsToEmbed(texts), [texts])
  const signature = needed.join('\u0001')
  const [vectors, setVectors] = useState<Map<string, Float32Array>>(() => new Map())
  const [checked, setChecked] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<EmbedProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const vectorsRef = useRef(vectors)
  const runningRef = useRef(false)
  const neededRef = useRef(needed)

  useEffect(() => {
    vectorsRef.current = vectors
    neededRef.current = needed
  })

  const merge = useCallback((found: Map<string, Float32Array>) => {
    if (!found.size) return
    setVectors((current) => new Map([...current, ...found]))
  }, [])

  const run = useCallback(() => {
    if (runningRef.current) return
    const pending = neededRef.current.filter((text) => !vectorsRef.current.has(text))
    if (!pending.length) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    setProgress(null)
    embedTexts(pending, setProgress)
      .then(merge)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Embedding failed.'))
      .finally(() => {
        runningRef.current = false
        setRunning(false)
        setProgress(null)
      })
  }, [merge])

  useEffect(() => {
    let cancelled = false
    const pending = neededRef.current.filter((text) => !vectorsRef.current.has(text))
    readCached(pending)
      .catch(() => new Map<string, Float32Array>())
      .then((found) => {
        if (cancelled) return
        merge(found)
        setChecked(signature)
        // Once the model is loaded in this session, keep vectors current as notes change without asking again.
        if (found.size < pending.length && isModelLoaded()) run()
      })
    return () => { cancelled = true }
  }, [signature, merge, run])

  const missing = needed.filter((text) => !vectors.has(text)).length
  const status: SimilarityStatus = running ? 'running' : error ? 'error' : checked !== signature ? 'checking' : missing ? 'idle' : 'ready'

  const vectorOf = useCallback((text: string) => vectors.get(text), [vectors])
  const analysis = useMemo(() => {
    if (!vectors.size) return null
    const titles = new Map(slides.map((s) => [s.content.number, slideTitle(s)]))
    return analyzeDeck(texts, vectorOf, titles)
  }, [slides, texts, vectorOf, vectors.size])
  const textsFor = useCallback((slideNumber: number) => texts.find((t) => t.number === slideNumber), [texts])

  return { status, progress, error, missing, partial: vectors.size > 0 && missing > 0, analysis, run, textsFor }
}
