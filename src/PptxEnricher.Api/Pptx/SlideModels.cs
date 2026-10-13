namespace PptxEnricher.Api.Pptx;

public sealed record DeckContent(string Title, IReadOnlyList<SlideContent> Slides);

public sealed record SlideContent
{
    public required int Number { get; init; }
    public string? Title { get; init; }
    public string? Section { get; init; }
    public string? LayoutName { get; init; }
    public bool Hidden { get; init; }
    public IReadOnlyList<SlideParagraph> Paragraphs { get; init; } = [];
    public IReadOnlyList<SlideTable> Tables { get; init; } = [];
    public int PictureCount { get; init; }
    public IReadOnlyList<string> PictureDescriptions { get; init; } = [];
    public int ChartCount { get; init; }
    public IReadOnlyList<string> ChartTitles { get; init; } = [];
    public IReadOnlyList<string> Links { get; init; } = [];
    public bool HasNotesPart { get; init; }
    public string Notes { get; init; } = "";

    /// <summary>All visible slide text (title, paragraphs, tables, chart titles) as plain text.</summary>
    public string AllText()
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(Title)) parts.Add(Title);
        parts.AddRange(Paragraphs.Select(p => p.Text));
        parts.AddRange(Tables.SelectMany(t => t.Rows).SelectMany(r => r));
        parts.AddRange(ChartTitles);
        return string.Join('\n', parts.Where(p => !string.IsNullOrWhiteSpace(p)));
    }
}

public sealed record SlideParagraph(string Text, int Level);

public sealed record SlideTable(IReadOnlyList<IReadOnlyList<string>> Rows);
