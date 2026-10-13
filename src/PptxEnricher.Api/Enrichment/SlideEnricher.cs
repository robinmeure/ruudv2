using System.Text.Json;
using GitHub.Copilot;
using GitHub.Copilot.Rpc;
using Microsoft.Extensions.Options;
using PptxEnricher.Api.Storage;

namespace PptxEnricher.Api.Enrichment;

public interface ISlideEnricher
{
    Task<EnrichmentProposal> EnrichAsync(DeckState deck, int slideNumber, string? model,
        Action<string> onActivity, CancellationToken cancellationToken);
}

/// <summary>Runs one Copilot session (web research only) to propose enriched speaker notes for a slide.</summary>
public sealed class SlideEnricher(
    CopilotConnection connection,
    IOptions<CopilotOptions> options,
    TimeProvider time,
    ILogger<SlideEnricher> logger) : ISlideEnricher
{
    private const int MaxActivityChars = 300;
    private const int MaxReasoningChars = 600;

    private const string RetryPrompt =
        "Your previous answer could not be used because it was not valid JSON for the requested schema or had empty speaker notes. " +
        "Reply again with only the JSON object, using the research you already did.";

    public async Task<EnrichmentProposal> EnrichAsync(
        DeckState deck,
        int slideNumber,
        string? model,
        Action<string> onActivity,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var slide = deck.Slides[slideNumber - 1];
        var today = DateOnly.FromDateTime(time.GetLocalNow().DateTime);
        var prompt = PromptBuilder.Build(deck, slide, today, settings.MaxWords);
        var wordBudget = SpeakerNotesRules.WordBudgetPerLanguage(settings.MaxWords);
        var requestedModel = string.IsNullOrWhiteSpace(model) ? NullIfEmpty(settings.Model) : model.Trim();

        var client = await connection.GetClientAsync(cancellationToken);
        var workDirectory = Path.Combine(Path.GetTempPath(), "PptxEnricher", "copilot");
        Directory.CreateDirectory(workDirectory);

        var releaseCommunicationsUrl = NullIfEmpty(settings.ReleaseCommunicationsMcpUrl);
        var includeReleaseCommunications = releaseCommunicationsUrl is not null
            && Uri.TryCreate(releaseCommunicationsUrl, UriKind.Absolute, out var mcpUri)
            && mcpUri.Scheme == Uri.UriSchemeHttps;

        CopilotSession session;
        try
        {
            session = await client.CreateSessionAsync(new SessionConfig
            {
                Model = requestedModel,
                WorkingDirectory = workDirectory,
                AvailableTools = [.. ToolPolicy.AvailableTools(includeReleaseCommunications)],
                McpServers = includeReleaseCommunications
                    ? new Dictionary<string, McpServerConfig>
                    {
                        [ToolPolicy.ReleaseCommunicationsServer] = new McpHttpServerConfig
                        {
                            Url = releaseCommunicationsUrl!,
                            Tools = [.. ToolPolicy.ReleaseCommunicationsTools],
                        },
                    }
                    : null,
                ReasoningSummary = ReasoningSummary.Concise,
                EnableSessionStore = false,
                SkipCustomInstructions = true,
                SystemMessage = new SystemMessageConfig { Mode = SystemMessageMode.Append, Content = PromptBuilder.SystemMessage },
                OnPermissionRequest = (request, _) =>
                {
                    var decision = ToolPolicy.Evaluate(request);
                    if (!decision.Approved) onActivity($"Blocked: {decision.Description}");
                    return Task.FromResult(decision.Approved
                        ? PermissionDecision.ApproveOnce()
                        : PermissionDecision.Reject(decision.Description));
                },
            }, cancellationToken);
        }
        catch (Exception ex) when (IsConnectionFailure(ex))
        {
            await connection.ResetAsync(client);
            throw;
        }

        var usedModel = requestedModel;
        var toolLabels = new System.Collections.Concurrent.ConcurrentDictionary<string, string>();
        using var subscription = session.On<SessionEvent>(evt =>
        {
            switch (evt)
            {
                case AssistantIntentEvent intent when !string.IsNullOrWhiteSpace(intent.Data.Intent):
                    onActivity($"Plan: {Shorten(intent.Data.Intent, MaxActivityChars)}");
                    break;
                case AssistantReasoningEvent reasoning when !string.IsNullOrWhiteSpace(reasoning.Data.Content):
                    onActivity($"Thinking: {Shorten(reasoning.Data.Content, MaxReasoningChars)}");
                    break;
                case ToolExecutionStartEvent start:
                    var label = DescribeToolStart(start.Data);
                    if (start.Data.ToolCallId is { Length: > 0 } startId) toolLabels[startId] = label;
                    onActivity(label);
                    break;
                case ToolExecutionCompleteEvent { Data.Success: false } failed:
                    onActivity($"Tool failed: {Shorten(failed.Data.Error?.Message ?? "unknown error", MaxActivityChars)}");
                    break;
                case ToolExecutionCompleteEvent done:
                    var content = done.Data.Result?.Content;
                    var found = done.Data.ToolCallId is { Length: > 0 } doneId && toolLabels.TryRemove(doneId, out var text) ? text : "Tool";
                    onActivity($"Result: {Shorten(found, 90)}{(content is null ? "" : $" ({FormatSize(content.Length)})")}");
                    break;
                case AssistantMessageEvent message when !string.IsNullOrWhiteSpace(message.Data.Model):
                    usedModel = message.Data.Model;
                    break;
                case SessionErrorEvent error:
                    onActivity($"Copilot error: {error.Data.Message}");
                    break;
            }
        });

        try
        {
            onActivity($"Researching with Copilot{(requestedModel is null ? "" : $" ({requestedModel})")}");
            var response = await SendAsync(session, prompt, settings.SlideTimeout, cancellationToken);
            if (response is null || string.IsNullOrWhiteSpace(response.SpeakerNotes))
            {
                onActivity("Response was not usable; asking Copilot to retry");
                response = await SendAsync(session, RetryPrompt, settings.SlideTimeout, cancellationToken)
                    ?? throw new InvalidOperationException("Copilot did not return usable speaker notes.");
            }

            var check = SpeakerNotesRules.Check(response.SpeakerNotes, wordBudget);
            for (var attempt = 0; attempt < settings.RepairAttempts && check.Violations.Count > 0; attempt++)
            {
                onActivity($"Notes break {check.Violations.Count} writing rule{(check.Violations.Count == 1 ? "" : "s")}; asking Copilot to fix {(check.Violations.Count == 1 ? "it" : "them")}");
                var repaired = await SendAsync(session, PromptBuilder.BuildRepair(check), settings.SlideTimeout, cancellationToken);
                if (repaired is null || string.IsNullOrWhiteSpace(repaired.SpeakerNotes)) break;
                response = KeepEvidence(response, repaired);
                check = SpeakerNotesRules.Check(response.SpeakerNotes, wordBudget);
            }

            return ProposalNormalizer.ToProposal(response, usedModel, time.GetUtcNow(), wordBudget);
        }
        catch (Exception ex) when (ex is OperationCanceledException or TimeoutException)
        {
            await AbortQuietlyAsync(session);
            if (ex is OperationCanceledException && cancellationToken.IsCancellationRequested) throw;
            throw new TimeoutException($"Copilot did not finish within {settings.SlideTimeout.TotalMinutes:0.#} minutes.", ex);
        }
        catch (Exception ex) when (IsConnectionFailure(ex))
        {
            await connection.ResetAsync(client);
            throw;
        }
        finally
        {
            var sessionId = session.SessionId;
            try
            {
                await session.DisposeAsync();
                if (settings.DeleteSessions) await client.DeleteSessionAsync(sessionId, CancellationToken.None);
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "Could not clean up Copilot session {SessionId}", sessionId);
            }
        }
    }

    private async Task<EnrichmentResponse?> SendAsync(CopilotSession session, string prompt, TimeSpan timeout, CancellationToken cancellationToken)
    {
        try
        {
            return await session.SendAndWaitAsync<EnrichmentResponse>(prompt, serializerOptions: null, timeout, cancellationToken);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Copilot returned JSON that does not match the enrichment schema");
            return null;
        }
    }

    /// <summary>A repair answer replaces the notes; it keeps the original evidence when the repair left it out.</summary>
    internal static EnrichmentResponse KeepEvidence(EnrichmentResponse original, EnrichmentResponse repaired) => repaired with
    {
        KeyFacts = repaired.KeyFacts is { Count: > 0 } ? repaired.KeyFacts : original.KeyFacts,
        Sources = repaired.Sources is { Count: > 0 } ? repaired.Sources : original.Sources,
        Warnings = [.. (original.Warnings ?? []).Concat(repaired.Warnings ?? []).Distinct()],
        Confidence = string.IsNullOrWhiteSpace(repaired.Confidence) ? original.Confidence : repaired.Confidence,
    };

    private static string DescribeToolStart(ToolExecutionStartData data)
    {
        var args = data.Arguments is { ValueKind: JsonValueKind.Object } a ? a : default;
        var tool = data.McpToolName is { Length: > 0 } mcpTool ? mcpTool : data.ToolName;
        return tool switch
        {
            ToolPolicy.WebSearch => $"Searching the web: {GetString(args, "query") ?? "…"}",
            ToolPolicy.WebFetch => $"Reading {GetString(args, "url") ?? "a web page"}",
            ToolPolicy.AzureUpdatesSearch => $"Searching Azure Updates{Describe(args, "search", "filter")}",
            ToolPolicy.AzureUpdateById => $"Reading Azure update {GetString(args, "id") ?? ""}".TrimEnd(),
            _ => $"Running tool {data.ToolName}",
        };
    }

    private static string Describe(JsonElement args, params string[] names)
    {
        var parts = names.Select(n => GetString(args, n) is { Length: > 0 } v ? $"{n}: {v}" : null).OfType<string>().ToList();
        return parts.Count == 0 ? "" : $" ({string.Join(", ", parts)})";
    }

    private static string Shorten(string value, int max)
    {
        var text = System.Text.RegularExpressions.Regex.Replace(value, @"\s+", " ").Trim();
        return text.Length <= max ? text : text[..(max - 1)].TrimEnd() + "…";
    }

    private static string FormatSize(int chars) => chars < 1024 ? $"{chars} chars" : $"{chars / 1024.0:0.#} KB";

    private static string? GetString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private async Task AbortQuietlyAsync(CopilotSession session)
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await session.AbortAsync(cts.Token);
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Could not abort Copilot session {SessionId}", session.SessionId);
        }
    }

    internal static bool IsConnectionFailure(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is IOException or System.Net.Sockets.SocketException or ObjectDisposedException
                || current.GetType().Name.Contains("ConnectionLost", StringComparison.Ordinal))
                return true;
        }
        return false;
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
