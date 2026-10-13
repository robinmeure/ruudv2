using System.Text.RegularExpressions;
using PptxEnricher.Api.Storage;

namespace PptxEnricher.Api.Enrichment;

/// <summary>Turns the model's structured answer into a clean, plain-text proposal suitable for PowerPoint notes.</summary>
public static partial class ProposalNormalizer
{
    private static readonly string[] Confidences = ["high", "medium", "low"];

    public static EnrichmentProposal ToProposal(EnrichmentResponse response, string? model, DateTimeOffset createdAt, int wordBudgetPerLanguage)
    {
        var check = SpeakerNotesRules.Check(response.SpeakerNotes, wordBudgetPerLanguage);
        if (check.Notes.Length == 0)
            throw new InvalidOperationException("Copilot returned empty speaker notes.");

        var sources = new List<SourceRef>();
        var renumber = new Dictionary<int, int>();
        var rawSources = response.Sources ?? [];
        for (var i = 0; i < rawSources.Count; i++)
        {
            var url = rawSources[i]?.Url?.Trim();
            if (url is null || !ToolPolicy.EvaluateUrl(url).Approved) continue;
            var at = sources.FindIndex(s => string.Equals(s.Url.TrimEnd('/'), url.TrimEnd('/'), StringComparison.OrdinalIgnoreCase));
            if (at < 0)
            {
                var title = rawSources[i].Title?.Trim();
                sources.Add(new SourceRef(string.IsNullOrEmpty(title) ? url : title, url));
                at = sources.Count - 1;
            }
            renumber[i + 1] = at + 1;
        }

        var keyFacts = CleanList((response.KeyFacts ?? []).Select(fact => Renumber(fact, renumber)));
        var warnings = CleanList((response.Warnings ?? []).Concat(check.All.Select(issue => $"Format check: {issue}")));

        var confidence = response.Confidence?.Trim().ToLowerInvariant();
        return new EnrichmentProposal(
            check.Notes,
            keyFacts,
            sources,
            warnings,
            check.Language,
            Confidences.Contains(confidence) ? confidence! : "medium",
            model,
            createdAt);
    }

    /// <summary>Points "[n]" markers at the cleaned source list, dropping markers for sources that were removed.</summary>
    private static string Renumber(string fact, IReadOnlyDictionary<int, int> renumber)
    {
        if (string.IsNullOrWhiteSpace(fact)) return "";
        var renumbered = SourceMarkerRegex().Replace(fact, m =>
            int.TryParse(m.Groups[1].Value, out var n) && renumber.TryGetValue(n, out var mapped) ? $"[{mapped}]" : "");
        renumbered = RepeatedMarkerRegex().Replace(renumbered, "$1");
        renumbered = MultipleSpacesRegex().Replace(renumbered, " ");
        return SpaceBeforePunctuationRegex().Replace(renumbered.Trim(), "$1");
    }

    public static string NormalizeNotes(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes)) return "";
        var lines = notes.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n')
            .Select(line =>
            {
                var l = line.TrimEnd();
                l = HeadingRegex().Replace(l, "");
                l = BoldRegex().Replace(l, "$2");
                l = BulletRegex().Replace(l, "$1• ");
                return l;
            });
        var text = string.Join('\n', lines);
        return BlankLinesRegex().Replace(text, "\n\n").Trim();
    }

    private static List<string> CleanList(IEnumerable<string>? items) =>
        (items ?? []).Where(i => !string.IsNullOrWhiteSpace(i)).Select(i => i.Trim()).Distinct().ToList();

    [GeneratedRegex(@"^\s{0,3}#{1,6}\s+")]
    private static partial Regex HeadingRegex();

    [GeneratedRegex(@"(\*\*|__)(.+?)\1")]
    private static partial Regex BoldRegex();

    [GeneratedRegex(@"^(\s*)[-*]\s+")]
    private static partial Regex BulletRegex();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex BlankLinesRegex();

    [GeneratedRegex(@"\[\s*(\d+)\s*\]")]
    private static partial Regex SourceMarkerRegex();

    [GeneratedRegex(@"(\[\d+\])(?:\s*\1)+")]
    private static partial Regex RepeatedMarkerRegex();

    [GeneratedRegex(@"\s+([.,;:!?])")]
    private static partial Regex SpaceBeforePunctuationRegex();

    [GeneratedRegex(@" {2,}")]
    private static partial Regex MultipleSpacesRegex();
}
