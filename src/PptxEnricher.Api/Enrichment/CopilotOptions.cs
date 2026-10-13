namespace PptxEnricher.Api.Enrichment;

public sealed class CopilotOptions
{
    /// <summary>Address of the user's headless Copilot CLI (<c>copilot --headless --port N</c>), e.g. <c>localhost:4321</c>.</summary>
    public string CliUrl { get; set; } = "localhost:4321";

    /// <summary>Shared secret matching the CLI's <c>COPILOT_CONNECTION_TOKEN</c>, if one was set.</summary>
    public string? ConnectionToken { get; set; }

    /// <summary>Model id to use; empty means the CLI's default.</summary>
    public string? Model { get; set; }

    public int MaxConcurrency { get; set; } = 4;

    public TimeSpan SlideTimeout { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>Delete the CLI session after each slide so enrichment runs don't clutter the user's session history.</summary>
    public bool DeleteSessions { get; set; } = true;

    /// <summary>
    /// Microsoft's Release Communications MCP server, which serves Azure Updates (azure.microsoft.com/updates renders client-side and
    /// cannot be fetched). Set to empty to disable. Only the two read-only Azure Updates tools are exposed.
    /// </summary>
    public string? ReleaseCommunicationsMcpUrl { get; set; } = "https://www.microsoft.com/releasecommunications/mcp";

    public int MaxWords { get; set; } = 250;

    /// <summary>Follow-up turns in which Copilot is asked to fix notes that break the measurable writing rules; 0 disables them.</summary>
    public int RepairAttempts { get; set; } = 1;
}
