import { ModelRegistry, pipeline, type FeatureExtractionPipeline, type ProgressInfo } from '@huggingface/transformers'
import { e5Input, embeddingModel } from './similarity'

export type EmbedRequest = { id: number; texts: string[] }

export type EmbedResponse =
  | { type: 'download'; loaded: number; total: number; cached: boolean }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; vectors: Float32Array[] }
  | { type: 'error'; id: number; message: string }

const batchSize = 8
let extractor: Promise<FeatureExtractionPipeline> | null = null

function post(message: EmbedResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

const options = { device: 'wasm', dtype: 'q8' } as const

async function create(): Promise<FeatureExtractionPipeline> {
  // Transformers.js reports the same progress whether it fetches from Hugging Face or reads its Cache API copy.
  const cached = await ModelRegistry.is_pipeline_cached('feature-extraction', embeddingModel, options).catch(() => false)
  return pipeline('feature-extraction', embeddingModel, {
    ...options,
    progress_callback: (info: ProgressInfo) => {
      if (info.status === 'progress_total') post({ type: 'download', loaded: info.loaded, total: info.total, cached })
    },
  })
}

function load(): Promise<FeatureExtractionPipeline> {
  extractor ??= create().catch((error: unknown) => {
    extractor = null
    throw error
  })
  return extractor
}

self.onmessage = async ({ data }: MessageEvent<EmbedRequest>) => {
  const { id, texts } = data
  try {
    const embed = await load()
    const vectors: Float32Array[] = []
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize).map(e5Input)
      const output = await embed(batch, { pooling: 'mean', normalize: true })
      const width = output.dims[1]
      const values = output.data as Float32Array
      for (let row = 0; row < batch.length; row++) vectors.push(values.slice(row * width, (row + 1) * width))
      post({ type: 'progress', id, done: vectors.length, total: texts.length })
    }
    post({ type: 'result', id, vectors }, vectors.map((v) => v.buffer))
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}
