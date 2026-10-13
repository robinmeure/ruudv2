using GitHub.Copilot;
using Microsoft.Extensions.Options;

namespace PptxEnricher.Api.Enrichment;

public sealed record CopilotModel(string Id, string Name, double? Multiplier);

public sealed record CopilotStatus(
    bool Connected,
    string CliUrl,
    string? Version,
    bool Authenticated,
    string? Login,
    string? AuthType,
    string? StatusMessage,
    string? ConfiguredModel,
    IReadOnlyList<CopilotModel> Models,
    string? Error);

/// <summary>
/// Owns the single SDK client connected to the user's own headless Copilot CLI.
/// The client is created lazily and recreated after a connection failure (e.g. the CLI was restarted).
/// </summary>
public sealed class CopilotConnection(IOptions<CopilotOptions> options, ILogger<CopilotConnection> logger) : IAsyncDisposable
{
    private static readonly TimeSpan ModelCacheDuration = TimeSpan.FromMinutes(10);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private CopilotClient? _client;
    private (DateTimeOffset At, IReadOnlyList<CopilotModel> Models)? _models;

    public CopilotOptions Options => options.Value;

    public async Task<CopilotClient> GetClientAsync(CancellationToken cancellationToken)
    {
        if (_client is { } existing) return existing;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_client is not null) return _client;

            var url = NormalizeUrl(Options.CliUrl);
            var connection = string.IsNullOrEmpty(Options.ConnectionToken)
                ? RuntimeConnection.ForUri(url)
                : RuntimeConnection.ForUri(url, Options.ConnectionToken);
            var client = new CopilotClient(new CopilotClientOptions { Connection = connection, Logger = logger });
            try
            {
                await client.StartAsync(cancellationToken);
            }
            catch
            {
                await DisposeQuietlyAsync(client);
                throw;
            }

            logger.LogInformation("Connected to Copilot CLI at {Url}", url);
            _client = client;
            return client;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Drops the current client so the next call reconnects.</summary>
    public async Task ResetAsync(CopilotClient failed)
    {
        await _gate.WaitAsync();
        try
        {
            if (!ReferenceEquals(_client, failed)) return;
            _client = null;
            _models = null;
        }
        finally
        {
            _gate.Release();
        }
        await DisposeQuietlyAsync(failed);
    }

    public async Task<CopilotStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        var url = NormalizeUrl(Options.CliUrl);
        var model = string.IsNullOrWhiteSpace(Options.Model) ? null : Options.Model;
        CopilotClient? client = null;
        try
        {
            client = await GetClientAsync(cancellationToken);
            var status = await client.GetStatusAsync(cancellationToken);
            var auth = await client.GetAuthStatusAsync(cancellationToken);
            var models = auth.IsAuthenticated ? await GetModelsAsync(client, cancellationToken) : [];
            return new CopilotStatus(true, url, status.Version, auth.IsAuthenticated, auth.Login, auth.AuthType, auth.StatusMessage, model, models, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Copilot CLI at {Url} is not reachable", url);
            if (client is not null) await ResetAsync(client);
            return new CopilotStatus(false, url, null, false, null, null, null, model, [], ex.Message);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_client is { } client)
        {
            _client = null;
            await DisposeQuietlyAsync(client);
        }
        _gate.Dispose();
    }

    private async Task<IReadOnlyList<CopilotModel>> GetModelsAsync(CopilotClient client, CancellationToken cancellationToken)
    {
        if (_models is { } cached && DateTimeOffset.UtcNow - cached.At < ModelCacheDuration) return cached.Models;
        var models = (await client.ListModelsAsync(cancellationToken))
            .Where(m => !string.Equals(m.Policy?.State, "disabled", StringComparison.OrdinalIgnoreCase))
            .Select(m => new CopilotModel(m.Id, string.IsNullOrWhiteSpace(m.Name) ? m.Id : m.Name, m.Billing?.Multiplier))
            .ToList();
        _models = (DateTimeOffset.UtcNow, models);
        return models;
    }

    /// <summary>Accepts <c>host:port</c> or a URL (tcp://, http://) and returns <c>host:port</c>.</summary>
    public static string NormalizeUrl(string? value)
    {
        var trimmed = (value ?? "").Trim().TrimEnd('/');
        if (trimmed.Length == 0) return "localhost:4321";
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) && !string.IsNullOrEmpty(uri.Host) && uri.Port > 0
            ? $"{uri.Host}:{uri.Port}"
            : trimmed;
    }

    private async Task DisposeQuietlyAsync(CopilotClient client)
    {
        try
        {
            await client.DisposeAsync();
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Ignoring error while disposing Copilot client");
        }
    }
}
