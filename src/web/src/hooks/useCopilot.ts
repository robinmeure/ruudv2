import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { CopilotStatus } from '../api/types'
import { useStoredString } from './useStored'

const modelPreferenceKey = 'notes-enricher:model'

export function useCopilotStatus() {
  return useQuery({
    queryKey: ['copilot-status'],
    queryFn: api.copilotStatus,
    refetchInterval: (query) => (query.state.data?.connected ? 30_000 : 10_000),
    retry: false,
  })
}

/** The model chosen in the console, or null for the CLI's own default. Ignores a stored model the CLI no longer offers. */
export function useChosenModel(status: CopilotStatus | undefined): [string | null, (model: string) => void] {
  const [stored, setStored] = useStoredString(modelPreferenceKey, '')
  const available = status?.models.some((m) => m.id === stored) ?? false
  return [stored && available ? stored : null, setStored]
}

export function modelLabel(status: CopilotStatus | undefined, model: string | null): string {
  if (model) return status?.models.find((m) => m.id === model)?.name ?? model
  return status?.configuredModel ?? 'the CLI default model'
}

export function copilotReady(status: CopilotStatus | undefined): boolean {
  return !!status?.connected && status.authenticated
}
