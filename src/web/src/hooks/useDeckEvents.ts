import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DeckEvent, DeckState, SlideState } from '../api/types'

export type LinkState = 'connecting' | 'live' | 'lost'

const maxActivity = 120

function patchSlide(deck: DeckState, number: number, patch: (slide: SlideState) => SlideState): DeckState {
  return {
    ...deck,
    slides: deck.slides.map((slide) => (slide.content.number === number ? patch(slide) : slide)),
  }
}

/** Streams a deck's server-sent events into the React Query cache. */
export function useDeckEvents(deckId: string): LinkState {
  const queryClient = useQueryClient()
  const [link, setLink] = useState<LinkState>('connecting')

  useEffect(() => {
    const deckKey = ['deck', deckId]
    const source = new EventSource(api.eventsUrl(deckId))
    source.onerror = () => {
      setLink('lost')
    }

    source.onmessage = (message: MessageEvent<string>) => {
      let event: DeckEvent
      try {
        event = JSON.parse(message.data) as DeckEvent
      } catch {
        return
      }

      switch (event.type) {
        case 'connected':
          setLink('live')
          // Also covers changes between the initial HTTP read and subscribing to the stream.
          void queryClient.invalidateQueries({ queryKey: deckKey })
          void queryClient.invalidateQueries({ queryKey: ['queue', deckId] })
          break
        case 'slide-status':
          if (event.slide && event.slideNumber) {
            const slide = event.slide
            queryClient.setQueryData<DeckState>(deckKey, (deck) =>
              deck ? patchSlide(deck, slide.content.number, () => slide) : deck,
            )
          }
          break
        case 'activity':
          if (event.slideNumber && event.message) {
            const line = event.message
            queryClient.setQueryData<DeckState>(deckKey, (deck) =>
              deck
                ? patchSlide(deck, event.slideNumber!, (slide) => slide.jobId === event.jobId && slide.status === 'Running' ? ({
                    ...slide,
                    activity: [...slide.activity, line].slice(-maxActivity),
                  }) : slide)
                : deck,
            )
          }
          break
        case 'job':
          if (event.status === 'completed' || event.status === 'cancelled')
            void queryClient.invalidateQueries({ queryKey: ['decks'] })
          break
        case 'queue':
        case 'heartbeat':
          void queryClient.invalidateQueries({ queryKey: ['queue', deckId] })
          break
        default:
          break
      }
    }

    return () => source.close()
  }, [deckId, queryClient])

  return link
}
