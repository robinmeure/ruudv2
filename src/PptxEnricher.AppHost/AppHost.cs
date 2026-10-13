using System.Security.Cryptography;

var builder = DistributedApplication.CreateBuilder(args);

var copilotSection = builder.Configuration.GetSection("Copilot");
var api = builder.AddProject<Projects.PptxEnricher_Api>("api");

// Either connect to a Copilot CLI the user already runs (Copilot:CliUrl), or start the user's own CLI in headless mode.
// Both run as the current user, so they reuse the existing `copilot login` and the user's Copilot entitlement.
if (copilotSection["CliUrl"] is { Length: > 0 } existingCliUrl)
{
    api.WithEnvironment("Copilot__CliUrl", existingCliUrl);
    if (copilotSection["ConnectionToken"] is { Length: > 0 } existingToken)
        api.WithEnvironment("Copilot__ConnectionToken", existingToken);
}
else
{
    var port = int.TryParse(copilotSection["Port"], out var configuredPort) ? configuredPort : 4321;
    var token = builder.AddParameter("copilot-token", Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), secret: true);
    var (command, prefixArgs) = CopilotCli.Resolve(copilotSection["CliPath"]);
    var workingDirectory = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "PptxEnricher", "copilot")).FullName;

    var cli = builder.AddExecutable("copilot-cli", command, workingDirectory, [.. prefixArgs, "--headless", "--port", port.ToString()])
        .WithEnvironment("COPILOT_CONNECTION_TOKEN", token)
        .WithEndpoint(name: "rpc", port: port, targetPort: port, scheme: "tcp", isProxied: false);

    var cliUrl = "localhost:" + port;
    api.WithEnvironment("Copilot__CliUrl", cliUrl)
        .WithEnvironment("Copilot__ConnectionToken", token)
        .WaitFor(cli);
}

// A fixed browser port keeps the web origin stable across restarts. The origin scopes the browser caches that hold
// the embedding model (Cache API) and slide vectors (IndexedDB), so a new port would mean downloading the model again.
var webPort = int.TryParse(builder.Configuration["Web:Port"], out var configuredWebPort) ? configuredWebPort : 5173;

builder.AddViteApp("web", "../web")
    .WithReference(api)
    .WaitFor(api)
    .WithEndpoint("http", endpoint => endpoint.Port = webPort)
    .WithExternalHttpEndpoints();

builder.Build().Run();

internal static class CopilotCli
{
    /// <summary>
    /// Finds the user's installed Copilot CLI. On Windows the npm install is a .cmd shim, which is launched
    /// through node directly so the process (and its shutdown) is managed cleanly.
    /// </summary>
    public static (string Command, string[] PrefixArgs) Resolve(string? configuredPath)
    {
        if (!string.IsNullOrWhiteSpace(configuredPath)) return (configuredPath, []);

        var directories = (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var directory in directories)
        {
            if (OperatingSystem.IsWindows())
            {
                var exe = Path.Combine(directory, "copilot.exe");
                if (File.Exists(exe)) return (exe, []);

                if (File.Exists(Path.Combine(directory, "copilot.cmd")))
                {
                    var loader = Path.Combine(directory, "node_modules", "@github", "copilot", "npm-loader.js");
                    if (File.Exists(loader)) return ("node", [loader]);
                }
            }
            else
            {
                var binary = Path.Combine(directory, "copilot");
                if (File.Exists(binary)) return (binary, []);
            }
        }

        return ("copilot", []);
    }
}
