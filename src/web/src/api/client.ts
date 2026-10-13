import type {
  CopilotStatus,
  DeckState,
  DeckSummary,
  EnrichmentJobInfo,
  ResearchQueueState,
  ReviewDecision,
  SlideState,
} from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface ProblemDetails {
  title?: string
  detail?: string
  errors?: Record<string, string[]>
}

async function readError(response: Response): Promise<ApiError> {
  const fallback = `The server answered ${response.status} ${response.statusText}.`
  const text = await response.text().catch(() => '')
  if (!text) return new ApiError(response.status, fallback)

  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'string') return new ApiError(response.status, parsed)
    const problem = parsed as ProblemDetails
    const fieldErrors = problem.errors ? Object.values(problem.errors).flat() : []
    return new ApiError(response.status, fieldErrors[0] ?? problem.detail ?? problem.title ?? fallback)
  } catch {
    return new ApiError(response.status, text.length < 200 ? text : fallback)
  }
}

async function requestResponse(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'The Notes Enricher API is not reachable. Is the AppHost running?')
  }
  if (!response.ok) throw await readError(response)
  return response
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestResponse(path, init)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function sendJson<T>(method: string, path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  copilotStatus: () => request<CopilotStatus>('/api/copilot/status'),

  listDecks: () => request<DeckSummary[]>('/api/decks'),
  getDeck: (id: string) => request<DeckState>(`/api/decks/${encodeURIComponent(id)}`),
  getQueue: (id: string) => request<ResearchQueueState>(`/api/decks/${encodeURIComponent(id)}/queue`),
  deleteDeck: (id: string) => request<void>(`/api/decks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  uploadDeck: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<DeckState>('/api/decks', { method: 'POST', body: form })
  },

  enrichDeck: (id: string, slides: number[] | null, model: string | null) =>
    sendJson<EnrichmentJobInfo>('POST', `/api/decks/${encodeURIComponent(id)}/enrich`, { slides, model }),

  enrichSlide: (id: string, number: number, model: string | null) =>
    sendJson<EnrichmentJobInfo>('POST', `/api/decks/${encodeURIComponent(id)}/slides/${number}/enrich`, {
      slides: null,
      model,
    }),

  cancelDeck: (id: string) => request<void>(`/api/decks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  cancelJob: (jobId: string) => request<void>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
  cancelSlide: (id: string, number: number, jobId: string) =>
    sendJson<SlideState>('POST', `/api/decks/${encodeURIComponent(id)}/slides/${number}/cancel`, { jobId }),

  review: (id: string, number: number, status: ReviewDecision, notes?: string) =>
    sendJson<SlideState>('PUT', `/api/decks/${encodeURIComponent(id)}/slides/${number}/review`, {
      status,
      notes: notes ?? null,
    }),

  exportUrl: (id: string) => `/api/decks/${encodeURIComponent(id)}/export`,
  exportDeck: async (id: string) => (await requestResponse(`/api/decks/${encodeURIComponent(id)}/export`)).blob(),
  eventsUrl: (id: string) => `/api/decks/${encodeURIComponent(id)}/events`,
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
