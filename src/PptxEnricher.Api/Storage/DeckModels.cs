using System.Text.Json.Serialization;
using PptxEnricher.Api.Assessment;
using PptxEnricher.Api.Pptx;

namespace PptxEnricher.Api.Storage;

[JsonConverter(typeof(JsonStringEnumConverter<EnrichmentStatus>))]
public enum EnrichmentStatus { Idle, Queued, Running, Succeeded, Failed, Cancelled }

[JsonConverter(typeof(JsonStringEnumConverter<ReviewStatus>))]
public enum ReviewStatus { None, Pending, Accepted, Rejected }

public sealed record SourceRef(string Title, string Url);

public sealed record EnrichmentProposal(
    string Notes,
    IReadOnlyList<string> KeyFacts,
    IReadOnlyList<SourceRef> Sources,
    IReadOnlyList<string> Warnings,
    string Language,
    string Confidence,
    string? Model,
    DateTimeOffset CreatedAt);

public sealed record SlideState(SlideContent Content, SlideAssessment Assessment)
{
    public EnrichmentStatus Status { get; init; } = EnrichmentStatus.Idle;
    public string? Error { get; init; }
    public string? JobId { get; init; }
    public bool CancellationRequested { get; init; }
    public EnrichmentProposal? Proposal { get; init; }
    public ReviewStatus Review { get; init; } = ReviewStatus.None;
    public string? AcceptedNotes { get; init; }
    public IReadOnlyList<string> Activity { get; init; } = [];
}

public sealed record DeckState(
    string Id,
    string FileName,
    string Title,
    DateTimeOffset UploadedAt,
    IReadOnlyList<SlideState> Slides);

public sealed record DeckSummary(
    string Id,
    string FileName,
    string Title,
    DateTimeOffset UploadedAt,
    int SlideCount,
    int FlaggedCount,
    int ProposalCount,
    int AcceptedCount)
{
    public static DeckSummary From(DeckState deck) => new(
        deck.Id,
        deck.FileName,
        deck.Title,
        deck.UploadedAt,
        deck.Slides.Count,
        deck.Slides.Count(s => s.Assessment.Flagged),
        deck.Slides.Count(s => s.Proposal is not null),
        deck.Slides.Count(s => s.Review == ReviewStatus.Accepted));
}
