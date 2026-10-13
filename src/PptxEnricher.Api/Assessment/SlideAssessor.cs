using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using PptxEnricher.Api.Pptx;

namespace PptxEnricher.Api.Assessment;

[JsonConverter(typeof(JsonStringEnumConverter<SlideKind>))]
public enum SlideKind { Title, Section, Agenda, Legal, Closing, Content }

[JsonConverter(typeof(JsonStringEnumConverter<NotesStatus>))]
public enum NotesStatus { Missing, PlaceholderOnly, Thin, Ok }

public sealed record SlideAssessment(
    SlideKind Kind,
    NotesStatus NotesStatus,
    int SlideWordCount,
    int NotesWordCount,
    double Coverage,
    bool NotesHaveSources,
    bool TimeSensitive,
    int Priority,
    bool Flagged,
    bool SuggestSkip,
    IReadOnlyList<string> Reasons);

public static partial class SlideAssessor
{
    public const int ThinNotesWordThreshold = 40;
    public const double LowCoverageThreshold = 0.3;

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        // English
        "about", "after", "also", "and", "are", "been", "before", "being", "both", "but", "can", "could", "does", "each",
        "for", "from", "have", "here", "into", "just", "like", "more", "most", "much", "must", "only", "other", "over",
        "same", "should", "some", "such", "than", "that", "their", "them", "then", "there", "these", "they", "this",
        "those", "through", "under", "very", "what", "when", "where", "which", "while", "will", "with", "within",
        "without", "would", "your", "yours", "the", "our", "you", "all", "any", "how", "new", "now", "use", "using",
        // Dutch
        "aan", "alle", "als", "bij", "dan", "dat", "deze", "die", "dit", "door", "een", "eens", "geen", "heeft", "hebben",
        "het", "hier", "hoe", "ook", "maar", "meer", "naar", "niet", "nog", "omdat", "onze", "over", "tot", "uit", "van",
        "veel", "voor", "waar", "wat", "wel", "wordt", "worden", "zijn", "zich", "zoals", "zodat", "met", "ons", "jouw",
    };

    public static SlideAssessment Assess(SlideContent slide)
    {
        var reasons = new List<string>();
        var slideText = slide.AllText();
        var slideWords = Words(slideText);
        var notesWords = Words(slide.Notes);

        var notesStatus = ClassifyNotes(slide.Notes, notesWords.Count);
        var kind = ClassifyKind(slide, slideWords.Count);
        var coverage = ComputeCoverage(slideWords, slide.Notes);
        var notesHaveSources = UrlRegex().IsMatch(slide.Notes);
        var timeSensitive = TimeSensitiveRegex().IsMatch(slideText);

        switch (notesStatus)
        {
            case NotesStatus.Missing: reasons.Add("No speaker notes."); break;
            case NotesStatus.PlaceholderOnly: reasons.Add("Notes only contain a placeholder (e.g. a slide number)."); break;
            case NotesStatus.Thin: reasons.Add($"Notes are thin ({notesWords.Count} words)."); break;
        }
        if (notesStatus != NotesStatus.Missing && notesStatus != NotesStatus.PlaceholderOnly && coverage < LowCoverageThreshold)
            reasons.Add($"Notes cover only {coverage:P0} of the slide's key terms.");
        if (timeSensitive)
            reasons.Add(notesHaveSources ? "Time-sensitive content (dates, retirements, releases)." : "Time-sensitive content without sources in the notes.");

        var priority = notesStatus switch
        {
            NotesStatus.Missing => 60,
            NotesStatus.PlaceholderOnly => 55,
            NotesStatus.Thin => 35,
            _ => 0,
        };
        priority += (int)Math.Round((1 - coverage) * 20);
        if (timeSensitive) priority += notesHaveSources ? 5 : 15;
        if (!notesHaveSources && kind == SlideKind.Content) priority += 5;

        var suggestSkip = kind != SlideKind.Content || slide.Hidden || slideWords.Count == 0;
        if (suggestSkip)
        {
            priority = (int)Math.Round(priority * 0.3);
            reasons.Add(slide.Hidden ? "Hidden slide." : $"{kind} slide; enrichment usually not needed.");
        }
        priority = Math.Clamp(priority, 0, 100);

        var flagged = !suggestSkip && (
            notesStatus != NotesStatus.Ok
            || coverage < LowCoverageThreshold
            || (timeSensitive && !notesHaveSources));

        return new SlideAssessment(kind, notesStatus, slideWords.Count, notesWords.Count, Math.Round(coverage, 2),
            notesHaveSources, timeSensitive, priority, flagged, suggestSkip, reasons);
    }

    internal static NotesStatus ClassifyNotes(string notes, int wordCount)
    {
        var trimmed = notes.Trim();
        if (trimmed.Length == 0) return NotesStatus.Missing;
        if (!trimmed.Any(char.IsLetter) || PlaceholderNotesRegex().IsMatch(trimmed)) return NotesStatus.PlaceholderOnly;
        return wordCount < ThinNotesWordThreshold ? NotesStatus.Thin : NotesStatus.Ok;
    }

    internal static SlideKind ClassifyKind(SlideContent slide, int slideWordCount)
    {
        var title = slide.Title ?? slide.Paragraphs.FirstOrDefault()?.Text ?? "";
        var layout = slide.LayoutName ?? "";
        var text = slide.AllText();

        if (LegalRegex().IsMatch(title) || (slideWordCount > 150 && LegalRegex().IsMatch(text))) return SlideKind.Legal;
        if (AgendaRegex().IsMatch(title)) return SlideKind.Agenda;
        if (ClosingRegex().IsMatch(title) && slideWordCount <= 15) return SlideKind.Closing;
        if (slide.Number == 1 && (slideWordCount <= 40 || layout.Contains("Title", StringComparison.OrdinalIgnoreCase))) return SlideKind.Title;
        if (SectionLayoutRegex().IsMatch(layout) && slideWordCount <= 25) return SlideKind.Section;
        if (slide.Tables.Count == 0 && slide.ChartCount == 0 && slideWordCount <= 6) return SlideKind.Section;
        return SlideKind.Content;
    }

    internal static double ComputeCoverage(IReadOnlyList<string> slideWords, string notes)
    {
        var keyTerms = slideWords
            .Where(w => w.Length >= 4 && !StopWords.Contains(w) && !w.All(char.IsDigit))
            .Select(w => w.ToLowerInvariant())
            .Distinct()
            .ToList();
        if (keyTerms.Count == 0) return 1;
        var notesTerms = Words(notes).Select(w => w.ToLowerInvariant()).ToHashSet();
        if (notesTerms.Count == 0) return 0;
        return (double)keyTerms.Count(notesTerms.Contains) / keyTerms.Count;
    }

    internal static List<string> Words(string text) =>
        WordRegex().Matches(text).Select(m => m.Value).ToList();

    [GeneratedRegex(@"[\p{L}\p{N}][\p{L}\p{N}\-'’.]*")]
    private static partial Regex WordRegex();

    [GeneratedRegex(@"https?://", RegexOptions.IgnoreCase)]
    private static partial Regex UrlRegex();

    [GeneratedRegex(@"^(click to add (notes|text)|klik om notities toe te voegen)\.?$", RegexOptions.IgnoreCase)]
    private static partial Regex PlaceholderNotesRegex();

    [GeneratedRegex(@"\b(20\d{2}|Q[1-4]|retire\w*|deprecat\w*|end of (life|support)|EOL|general(ly)? availab\w*|(?-i:GA)|preview|announc\w*|launch\w*|release[sd]?|roadmap|update[sd]?|upgrade|uitfaser\w*|aankondig\w*|beschikbaar|januari|january|februari|february|maart|march|april|mei|juni|june|juli|july|augustus|august|september|oktober|october|november|december)\b", RegexOptions.IgnoreCase)]
    private static partial Regex TimeSensitiveRegex();

    [GeneratedRegex(@"\b(terms and conditions|terms of use|disclaimer|legal|voorwaarden|confidential(ity)?)\b", RegexOptions.IgnoreCase)]
    private static partial Regex LegalRegex();

    [GeneratedRegex(@"^\s*(agenda|contents|table of contents|inhoud|overview)\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex AgendaRegex();

    [GeneratedRegex(@"\b(q\s*&\s*a|questions|thank you|thanks|bedankt|vragen|dank je|dank u)\b", RegexOptions.IgnoreCase)]
    private static partial Regex ClosingRegex();

    [GeneratedRegex(@"section|divider|header|break|sectie|transition", RegexOptions.IgnoreCase)]
    private static partial Regex SectionLayoutRegex();
}
