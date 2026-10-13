using System.Net;
using GitHub.Copilot;

namespace PptxEnricher.Api.Enrichment;

public readonly record struct PolicyDecision(bool Approved, string Description);

/// <summary>
/// Restricts what the Copilot agent may do on the user's machine: web research only.
/// </summary>
public static class ToolPolicy
{
    public const string WebSearch = "web_search";
    public const string WebFetch = "web_fetch";
    public const string GitHubMcpServer = "github-mcp-server";

    // The Azure Updates page renders client-side, so fetching it returns nothing; this official MCP server serves the same data.
    public const string ReleaseCommunicationsServer = "release-communications";
    public const string AzureUpdatesSearch = "get_recent_azure_updates";
    public const string AzureUpdateById = "get_azure_update_by_id";

    public static IReadOnlyList<string> ReleaseCommunicationsTools { get; } = [AzureUpdatesSearch, AzureUpdateById];

    /// <summary>The CLI exposes MCP tools as <c>server-tool</c> (and <c>server/tool</c>); both spellings are listed so the allowlist matches either.</summary>
    public static IReadOnlyList<string> AvailableTools(bool includeReleaseCommunications) =>
        includeReleaseCommunications
            ? [WebSearch, WebFetch, .. ReleaseCommunicationsTools.SelectMany(t => new[] { $"{ReleaseCommunicationsServer}-{t}", $"{ReleaseCommunicationsServer}/{t}" })]
            : [WebSearch, WebFetch];

    public static PolicyDecision Evaluate(PermissionRequest request) => request switch
    {
        PermissionRequestUrl url => EvaluateUrl(url.Url),
        PermissionRequestMcp { ServerName: GitHubMcpServer, ToolName: WebSearch } => new(true, "web search"),
        PermissionRequestMcp { ServerName: ReleaseCommunicationsServer } mcp when IsReleaseCommunicationsTool(mcp.ToolName) => new(true, "Azure Updates lookup"),
        PermissionRequestMcp mcp => new(false, $"MCP tool {mcp.ServerName}/{mcp.ToolName} is not allowed"),
        _ => new(false, $"'{request.Kind}' actions are not allowed; only web research is permitted"),
    };

    public static PolicyDecision EvaluateUrl(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            return new(false, $"Only http(s) URLs may be fetched ({url})");

        // Fetched pages are untrusted; keep a prompt-injected agent from probing the local network.
        if (IsLocalHost(uri))
            return new(false, $"Local or private network addresses may not be fetched ({uri.Host})");

        return new(true, $"fetch {uri}");
    }

    private static bool IsReleaseCommunicationsTool(string toolName) =>
        ReleaseCommunicationsTools.Any(tool =>
            toolName == tool
            || toolName == $"{ReleaseCommunicationsServer}-{tool}"
            || toolName == $"{ReleaseCommunicationsServer}/{tool}");

    private static bool IsLocalHost(Uri uri)
    {
        if (uri.IsLoopback) return true;
        var host = uri.IdnHost.TrimEnd('.');
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".internal", StringComparison.OrdinalIgnoreCase)
            || !host.Contains('.'))
            return true;

        if (!IPAddress.TryParse(host.Trim('[', ']'), out var ip)) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal) return true;

        var bytes = ip.GetAddressBytes();
        return bytes.Length == 4 && (
            bytes[0] is 10 or 127 or 0
            || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
            || (bytes[0] == 192 && bytes[1] == 168)
            || (bytes[0] == 169 && bytes[1] == 254)
            || (bytes[0] == 100 && bytes[1] is >= 64 and <= 127));
    }
}
