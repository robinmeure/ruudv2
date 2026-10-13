import { useCallback, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = () => listener()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable (private mode, quota); the preference just won't persist.
  }
  listeners.forEach((listener) => listener())
}

/** A string preference in localStorage that re-renders every subscriber when it changes. */
export function useStoredString(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key)) ?? fallback
  const setValue = useCallback((next: string) => writeStored(key, next), [key])
  return [value, setValue]
}
