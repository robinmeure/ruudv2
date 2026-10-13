using Microsoft.AspNetCore.Http.Features;
using PptxEnricher.Api.Endpoints;
using PptxEnricher.Api.Enrichment;
using PptxEnricher.Api.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();

builder.WebHost.ConfigureKestrel(kestrel => kestrel.Limits.MaxRequestBodySize = ApiEndpoints.MaxUploadBytes);
builder.Services.Configure<FormOptions>(form => form.MultipartBodyLengthLimit = ApiEndpoints.MaxUploadBytes);

builder.Services.Configure<CopilotOptions>(builder.Configuration.GetSection("Copilot"));
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<DeckStore>();
builder.Services.AddSingleton<DeckEventHub>();
builder.Services.AddSingleton<CopilotConnection>();
builder.Services.AddSingleton<ISlideEnricher, SlideEnricher>();
builder.Services.AddSingleton<EnrichmentJobQueue>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<EnrichmentJobQueue>());

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapDefaultEndpoints();
app.MapApiEndpoints();

app.Run();

public partial class Program;
