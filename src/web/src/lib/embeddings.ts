import type { EmbedRequest, EmbedResponse } from './embedding.worker'
import { embeddingModel } from './similarity'

const dbName = 'slide-embeddings'
const storeName = 'vectors'

export type EmbedProgress =
  | { phase: 'download'; loaded: number; total: number; cached: boolean }
  | { phase: 'embed'; done: number; total: number }

let database: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = null; reject(request.error) }
  })
  return database
}

const keyFor = (text: string) => [embeddingModel, text]

export async function readCached(texts: string[]): Promise<Map<string, Float32Array>> {
  const found = new Map<string, Float32Array>()
  if (!texts.length || typeof indexedDB === 'undefined') return found
  const db = await openDatabase()
  const store = db.transaction(storeName, 'readonly').objectStore(storeName)
  await Promise.all(texts.map((text) => new Promise<void>((resolve) => {
    const request = store.get(keyFor(text))
    request.onsuccess = () => { if (request.result instanceof Float32Array) found.set(text, request.result); resolve() }
    request.onerror = () => resolve()
  })))
  return found
}

async function writeCached(entries: [string, Float32Array][]): Promise<void> {
  if (!entries.length || typeof indexedDB === 'undefined') return
  const db = await openDatabase()
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)
  for (const [text, vector] of entries) store.put(vector, keyFor(text))
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

let worker: Worker | null = null
let nextId = 0
let modelLoaded = false

/** True once the model has been loaded in this page session, so further embedding needs no download. */
export const isModelLoaded = () => modelLoaded

/** Embeds texts in a background worker and caches the vectors in IndexedDB. */
export async function embedTexts(texts: string[], onProgress: (progress: EmbedProgress) => void): Promise<Map<string, Float32Array>> {
  const vectors = new Map<string, Float32Array>()
  if (!texts.length) return vectors
  worker ??= new Worker(new URL('./embedding.worker.ts', import.meta.url), { type: 'module' })
  const active = worker
  const id = ++nextId

  const result = await new Promise<Float32Array[]>((resolve, reject) => {
    const cleanup = () => {
      active.removeEventListener('message', listener)
      active.removeEventListener('error', failed)
    }
    const failed = (event: ErrorEvent) => {
      cleanup()
      worker = null
      active.terminate()
      reject(new Error(event.message || 'The embedding worker could not start.'))
    }
    const listener = ({ data }: MessageEvent<EmbedResponse>) => {
      if (data.type === 'download') { onProgress({ phase: 'download', loaded: data.loaded, total: data.total, cached: data.cached }); return }
      if (data.id !== id) return
      if (data.type === 'progress') { modelLoaded = true; onProgress({ phase: 'embed', done: data.done, total: data.total }); return }
      cleanup()
      if (data.type === 'result') resolve(data.vectors)
      else reject(new Error(data.message))
    }
    active.addEventListener('message', listener)
    active.addEventListener('error', failed)
    active.postMessage({ id, texts } satisfies EmbedRequest)
  })

  texts.forEach((text, index) => vectors.set(text, result[index]))
  await writeCached([...vectors]).catch(() => undefined)
  return vectors
}
