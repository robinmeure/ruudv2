import { copilotReady, useChosenModel, useCopilotStatus } from '../hooks/useCopilot'

export function CopilotLink() {
  const { data: status, isPending } = useCopilotStatus()
  const [model, setModel] = useChosenModel(status)

  const state = isPending ? 'pending' : copilotReady(status) ? 'live' : status?.connected ? 'warn' : 'down'
  const summary = isPending
    ? 'Raising Copilot CLI…'
    : !status?.connected
      ? 'Copilot CLI offline'
      : !status.authenticated
        ? 'Copilot CLI not signed in'
        : `Copilot CLI ${status.version ?? ''}`.trim()

  const detail = isPending
    ? null
    : !status?.connected
      ? `Nothing answers on ${status?.cliUrl ?? 'the configured address'}. Start the AppHost, or run copilot --headless.`
      : !status.authenticated
        ? 'Run copilot login in a terminal, then come back.'
        : `${status.login ?? 'Signed in'} · ${status.cliUrl}`

  return (
    <div className="copilot-link" data-state={state}>
      <span className="lamp" aria-hidden="true" />
      <div className="copilot-link-text" title={detail ?? undefined}>
        <span className="copilot-link-summary">{summary}</span>
        {detail && <span className="copilot-link-detail">{detail}</span>}
      </div>
      {copilotReady(status) && status && status.models.length > 0 && (
        <label className="model-select">
          <span className="field-label">Model</span>
          <select value={model ?? ''} onChange={(e) => setModel(e.target.value)}>
            <option value="">{status.configuredModel ? `Default (${status.configuredModel})` : 'CLI default'}</option>
            {status.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
