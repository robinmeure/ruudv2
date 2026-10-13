import { useSyncExternalStore } from 'react'

export type NoticeTone = 'info' | 'alert'

export interface Notice {
  id: number
  text: string
  tone: NoticeTone
}

let current: Notice | null = null
let nextId = 1
let timer: number | undefined
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function notify(text: string, tone: NoticeTone = 'info') {
  current = { id: nextId++, text, tone }
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    current = null
    emit()
  }, tone === 'alert' ? 9000 : 5000)
  emit()
}

export function dismissNotice() {
  window.clearTimeout(timer)
  current = null
  emit()
}

export function useNotice(): Notice | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}
