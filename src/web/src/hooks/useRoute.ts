import { useSyncExternalStore } from 'react'

export type Route =
  | { view: 'home' }
  | { view: 'deck'; deckId: string; slide: number | null }
  | { view: 'mockups'; concept: 'focus' | 'storyboard' | 'evidence' }
  | { view: 'fluent2-mockups' }

function parse(hash: string): Route {
  if (/^#\/mockups\/fluent2\/?$/.test(hash)) return { view: 'fluent2-mockups' }
  const mockup = /^#\/mockups(?:\/(focus|storyboard|evidence))?\/?$/.exec(hash)
  if (mockup) {
    return {
      view: 'mockups',
      concept: (mockup[1] as 'focus' | 'storyboard' | 'evidence' | undefined) ?? 'focus',
    }
  }
  const match = /^#\/decks\/([^/]+)(?:\/slides\/(\d+))?\/?$/.exec(hash)
  if (!match) return { view: 'home' }
  return { view: 'deck', deckId: decodeURIComponent(match[1]), slide: match[2] ? Number(match[2]) : null }
}

type NavigationGuard = (proceed: () => void, allowSave: boolean) => void

const listeners = new Set<() => void>()
let guard: NavigationGuard | null = null
let currentHash = window.location.hash
let currentIndex: number = window.history.state?.notesEnricherIndex ?? 0
let restoring: (() => void) | null = null
let permittedHash: string | null = null

window.history.replaceState({ ...window.history.state, notesEnricherIndex: currentIndex }, '')

function publish(hash: string) {
  currentHash = hash
  listeners.forEach((listener) => listener())
}

function commit(hash: string, replace: boolean) {
  if (hash === currentHash) return
  if (!replace) currentIndex++
  const state = { ...window.history.state, notesEnricherIndex: currentIndex }
  if (replace) window.history.replaceState(state, '', hash)
  else window.history.pushState(state, '', hash)
  publish(hash)
}

export function registerNavigationGuard(next: NavigationGuard): () => void {
  guard = next
  return () => { if (guard === next) guard = null }
}

export function runGuarded(proceed: () => void, allowSave = false) {
  if (guard) guard(proceed, allowSave)
  else proceed()
}

function onHistoryChange() {
  const hash = window.location.hash
  const index: number | undefined = window.history.state?.notesEnricherIndex
  if (restoring) {
    if (hash === currentHash && index === currentIndex) {
      const restored = restoring
      restoring = null
      restored()
    }
    return
  }
  if (hash === currentHash) return
  if (hash === permittedHash) {
    permittedHash = null
  } else if (guard) {
    const blocked = guard
    if (index !== undefined && index !== currentIndex) {
      // Restore the current history entry before asking, without destroying Back/Forward.
      const delta = index - currentIndex
      restoring = () => blocked(() => {
        permittedHash = hash
        window.history.go(delta)
      }, true)
      window.history.go(-delta)
    } else {
      window.history.replaceState({ ...window.history.state, notesEnricherIndex: currentIndex }, '', currentHash || '#/')
      blocked(() => commit(hash, true), true)
    }
    return
  }
  currentIndex = index ?? currentIndex + 1
  window.history.replaceState({ ...window.history.state, notesEnricherIndex: currentIndex }, '')
  publish(hash)
}

function onLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
  const anchor = event.target instanceof Element ? event.target.closest('a') : null
  if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
  const url = new URL(anchor.href)
  if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash.startsWith('#/')) return
  event.preventDefault()
  if (url.hash !== currentHash) runGuarded(() => commit(url.hash, false), true)
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (listeners.size === 1) {
    window.addEventListener('popstate', onHistoryChange)
    window.addEventListener('hashchange', onHistoryChange)
    document.addEventListener('click', onLinkClick)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      window.removeEventListener('popstate', onHistoryChange)
      window.removeEventListener('hashchange', onHistoryChange)
      document.removeEventListener('click', onLinkClick)
    }
  }
}

const getHash = () => currentHash

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash)
  return parse(hash)
}

export function hrefFor(route: Route): string {
  if (route.view === 'home') return '#/'
  if (route.view === 'mockups') return `#/mockups/${route.concept}`
  if (route.view === 'fluent2-mockups') return '#/mockups/fluent2'
  const base = `#/decks/${encodeURIComponent(route.deckId)}`
  return route.slide ? `${base}/slides/${route.slide}` : base
}

export function navigate(route: Route, replace = false) {
  const href = hrefFor(route)
  if (href !== currentHash) runGuarded(() => commit(href, replace), true)
}
