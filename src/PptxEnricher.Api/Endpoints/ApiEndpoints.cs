using DocumentFormat.OpenXml.Packaging;
using Microsoft.AspNetCore.Http.HttpResults;
using PptxEnricher.Api.Enrichment;
using PptxEnricher.Api.Pptx;
using PptxEnricher.Api.Storage;

namespace PptxEnricher.Api.Endpoints;

public sealed record EnrichRequest(int[]? Slides, string? Model);

public sealed record ReviewRequest(string Status, string? Notes);
public sealed record CancelSlideRequest(string? JobId);

public static class ApiEndpoints
{
    public const long MaxUploadBytes = 256L * 1024 * 1024;
    private const string PptxContentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    public static IEndpointRouteBuilder MapApiEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/copilot/status", (CopilotConnection connection, CancellationToken ct) => connection.GetStatusAsync(ct));

        var decks = api.MapGroup("/decks");
        decks.MapGet("/", (DeckStore store) => store.List());
        decks.MapPost("/", UploadAsync).DisableAntiforgery();
        decks.MapGet("/{id}", Results<Ok<DeckState>, NotFound> (string id, DeckStore store) =>
            store.Get(id) is { } deck ? TypedResults.Ok(deck) : TypedResults.NotFound());
        decks.MapDelete("/{id}", Results<NoContent, NotFound> (string id, DeckStore store, EnrichmentJobQueue queue) =>
        {
            queue.CancelDeck(id);
            return store.Delete(id) ? TypedResults.NoContent() : TypedResults.NotFound();
        });
        decks.MapGet("/{id}/events", Results<ServerSentEventsResult<DeckEvent>, NotFound> (string id, DeckStore store, DeckEventHub hub, CancellationToken ct) =>
            store.Get(id) is null
                ? TypedResults.NotFound()
                : TypedResults.ServerSentEvents(hub.SubscribeAsync(id, TimeSpan.FromSeconds(15), ct)));
        decks.MapPost("/{id}/enrich", EnrichDeck);
        decks.MapGet("/{id}/queue", Results<Ok<ResearchQueueState>, NotFound> (string id, DeckStore store, EnrichmentJobQueue queue) =>
            store.Get(id) is null ? TypedResults.NotFound() : TypedResults.Ok(queue.GetQueue(id)));
        decks.MapPost("/{id}/cancel", Results<NoContent, NotFound> (string id, DeckStore store, EnrichmentJobQueue queue) =>
        {
            if (store.Get(id) is null) return TypedResults.NotFound();
            queue.CancelDeck(id);
            return TypedResults.NoContent();
        });
        decks.MapPost("/{id}/slides/{number:int}/enrich", EnrichSlide);
        decks.MapPost("/{id}/slides/{number:int}/cancel", CancelSlide);
        decks.MapPut("/{id}/slides/{number:int}/review", Review);
        decks.MapGet("/{id}/export", ExportAsync);

        api.MapPost("/jobs/{jobId}/cancel", Results<NoContent, NotFound> (string jobId, EnrichmentJobQueue queue) =>
            queue.Cancel(jobId) ? TypedResults.NoContent() : TypedResults.NotFound());

        return app;
    }

    private static async Task<Results<Created<DeckState>, ValidationProblem>> UploadAsync(
        IFormFile? file, DeckStore store, ILoggerFactory loggerFactory, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return Invalid("file", "Choose a .pptx file to upload.");
        if (!string.Equals(Path.GetExtension(file.FileName), ".pptx", StringComparison.OrdinalIgnoreCase))
            return Invalid("file", "Only .pptx presentations are supported.");

        try
        {
            await using var stream = file.OpenReadStream();
            var deck = await store.CreateAsync(file.FileName, stream, ct);
            return TypedResults.Created($"/api/decks/{deck.Id}", deck);
        }
        catch (Exception ex) when (ex is OpenXmlPackageException or InvalidDataException or FileFormatException or InvalidOperationException)
        {
            loggerFactory.CreateLogger(typeof(ApiEndpoints)).LogWarning(ex, "Could not read uploaded presentation {FileName}", file.FileName);
            return Invalid("file", "The file could not be read as a PowerPoint presentation.");
        }
    }

    private static Results<Ok<EnrichmentJobInfo>, NotFound, ValidationProblem> EnrichDeck(
        string id, EnrichRequest? request, DeckStore store, EnrichmentJobQueue queue)
    {
        if (store.Get(id) is not { } deck) return TypedResults.NotFound();

        IEnumerable<int> slides;
        if (request?.Slides is { Length: > 0 } requested)
        {
            var invalid = requested.Where(n => n < 1 || n > deck.Slides.Count).ToList();
            if (invalid.Count > 0)
                return Invalid("slides", $"Slide number(s) out of range: {string.Join(", ", invalid)}.");
            slides = requested;
        }
        else
        {
            slides = deck.Slides
                .Where(s => s.Assessment.Flagged
                    && s.Proposal is null
                    && s.Review != ReviewStatus.Accepted
                    && s.Status is not (EnrichmentStatus.Queued or EnrichmentStatus.Running))
                .Select(s => s.Content.Number);
        }

        return TypedResults.Ok(queue.Enqueue(id, slides, request?.Model));
    }

    private static Results<Ok<EnrichmentJobInfo>, NotFound, Conflict<string>> EnrichSlide(
        string id, int number, EnrichRequest? request, DeckStore store, EnrichmentJobQueue queue)
    {
        if (store.Get(id) is not { } deck || number < 1 || number > deck.Slides.Count) return TypedResults.NotFound();
        var job = queue.Enqueue(id, [number], request?.Model);
        return job.Slides.Count == 0 ? TypedResults.Conflict("This slide is already being enriched.") : TypedResults.Ok(job);
    }

    private static Results<Ok<SlideState>, NotFound, ValidationProblem, Conflict<string>> CancelSlide(
        string id, int number, CancelSlideRequest request, DeckStore store, EnrichmentJobQueue queue)
    {
        if (store.Get(id) is not { } deck || number < 1 || number > deck.Slides.Count) return TypedResults.NotFound();
        if (string.IsNullOrWhiteSpace(request.JobId)) return Invalid("jobId", "Specify the slide's current research job.");
        return queue.CancelSlide(id, number, request.JobId) is { } slide
            ? TypedResults.Ok(slide)
            : TypedResults.Conflict("This research run is no longer active. Refresh the queue before stopping another run.");
    }

    private static Results<Ok<SlideState>, NotFound, ValidationProblem, Conflict<string>> Review(
        string id, int number, ReviewRequest request, DeckStore store, DeckEventHub hub)
    {
        if (store.Get(id) is not { } deck || number < 1 || number > deck.Slides.Count) return TypedResults.NotFound();
        if (deck.Slides[number - 1].Status is EnrichmentStatus.Queued or EnrichmentStatus.Running)
            return TypedResults.Conflict("Wait until enrichment of this slide has finished.");

        Func<SlideState, SlideState> update;
        switch (request.Status?.Trim().ToLowerInvariant())
        {
            case "accepted":
                var notes = ProposalNormalizer.NormalizeNotes(request.Notes ?? deck.Slides[number - 1].Proposal?.Notes);
                if (notes.Length == 0) return Invalid("notes", "Accepted notes can't be empty.");
                update = s => s with { Review = ReviewStatus.Accepted, AcceptedNotes = notes };
                break;
            case "rejected":
                update = s => s with { Review = ReviewStatus.Rejected, AcceptedNotes = null };
                break;
            case "pending":
                update = s => s with { Review = s.Proposal is null ? ReviewStatus.None : ReviewStatus.Pending, AcceptedNotes = null };
                break;
            default:
                return Invalid("status", "Status must be 'accepted', 'rejected' or 'pending'.");
        }

        var slide = store.UpdateSlide(id, number, update);
        if (slide is null) return TypedResults.NotFound();
        hub.Publish(new DeckEvent(DeckEventTypes.SlideStatus, id, number, Status: slide.Status.ToString(), Slide: slide));
        return TypedResults.Ok(slide);
    }

    private static async Task<Results<FileStreamHttpResult, NotFound, ValidationProblem>> ExportAsync(
        string id, DeckStore store, CancellationToken ct)
    {
        if (store.Get(id) is not { } deck) return TypedResults.NotFound();
        var accepted = deck.Slides
            .Where(s => s.Review == ReviewStatus.Accepted && !string.IsNullOrWhiteSpace(s.AcceptedNotes))
            .ToDictionary(s => s.Content.Number, s => s.AcceptedNotes!);
        if (accepted.Count == 0) return Invalid("slides", "Accept at least one slide's notes before exporting.");

        var output = new MemoryStream();
        await using (var original = store.OpenOriginal(id))
            await original.CopyToAsync(output, ct);
        output.Position = 0;
        PptxNotesWriter.ApplyNotes(output, accepted);
        output.Position = 0;

        var name = Path.GetFileNameWithoutExtension(deck.FileName);
        return TypedResults.File(output, PptxContentType, $"{name}-enriched.pptx");
    }

    private static ValidationProblem Invalid(string field, string message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
