using System.Text.RegularExpressions;
using PptxEnricher.Api.Assessment;

namespace PptxEnricher.Api.Enrichment;

/// <summary>Result of checking speaker notes against the measurable rules in the speaker-notes instructions.</summary>
/// <param name="Notes">The notes with the bilingual layout put into canonical form (when both sections were found).</param>
/// <param name="Language">"en+nl" when both language sections were found, otherwise "und".</param>
/// <param name="Violations">Hard rule breaks that Copilot is asked to repair.</param>
/// <param name="Advisories">Softer findings (length) that are only shown to the reviewer.</param>
public sealed record NotesCheck(string Notes, string Language, IReadOnlyList<string> Violations, IReadOnlyList<string> Advisories)
{
    public IEnumerable<string> All => Violations.Concat(Advisories);
}

/// <summary>Deterministic checks for the rules in <c>Prompts/speaker-notes-instructions.md</c> that can be measured in code.</summary>
public static partial class SpeakerNotesRules
{
    public const string EnglishHeading = "English Version";
    public const string DutchHeading = "Dutch Version";
    public const string Bilingual = "en+nl";
    public const int MaxSentencesPerLanguage = 5;

    /// <summary>Avoided words with the pattern that also catches their inflections.</summary>
    internal static readonly (string Word, string Pattern)[] AvoidWords =
    [
        ("groundbreaking", "groundbreaking"),
        ("revolutionary", "revolutionary"),
        ("transformative", "transformative"),
        ("powerful", "powerful(ly)?"),
        ("pivotal", "pivotal"),
        ("innovative", "innovative"),
        ("seamless", "seamless(ly)?"),
        ("major", @"major(?!\s+versions?\b)"),
        ("significant", "significant(ly|e)?"),
        ("enhanced", "enhanced"),
        ("improved", "improved"),
        ("baanbrekend", "baanbrekende?"),
        ("revolutionair", "revolutionaire?"),
        ("transformatief", "transformatie(f|ve)"),
        ("krachtig", "krachtiger?e?"),
        ("cruciaal", "cruci(aal|ale)"),
        ("innovatief", "innovatie(f|ve)"),
        ("naadloos", "naadlo(os|ze)"),
        ("ingrijpend", "ingrijpende?"),
        ("aanzienlijk", "aanzienlijke?"),
        ("verbeterd", "verbeterde?"),
    ];

    /// <summary>Terms that must stay in English in the Dutch version, with the Dutch renderings that break the rule.</summary>
    internal static readonly (string Term, string Pattern)[] ProtectedTerms =
    [
        ("subscription", "abonnement(en)?"),
        ("key", @"\w*sleutels?"),
        ("latency", "latentie"),
        ("resiliency", "veerkracht(ig|ige)?|weerbaarheid"),
        ("SLA", "serviceniveau-?overeenkomst(en)?"),
        ("throughput", "doorvoer(snelheid)?"),
        ("scale", @"\w*schaal\w*|\w*schal(en|ing|ig|ige)|scal(en|t|de|den)|gescaled?"),
        ("endpoint", "eindpunt(en)?"),
        ("workspace", "werkruimte[ns]?"),
        ("pipeline", "pijplijn(en)?"),
        ("policy", @"\w*beleid\w*"),
        ("tenant", "huurders?"),
        ("region", "regio('s)?"),
        ("connectivity", @"\w*connectiviteit"),
        ("monitoring", "bewaking"),
        ("logging", "logboekregistratie"),
        ("mirror", @"(ge)?spiegel\w*"),
        ("Public Preview", "(openbare|publieke) preview"),
        ("Private Preview", "(besloten|priv[ée]) preview"),
        ("General Availability", "algemene beschikbaarheid"),
        ("generally available", "algemeen beschikba(ar|re)"),
    ];

    private static readonly Regex[] AvoidWordRegexes =
        [.. AvoidWords.Select(w => new Regex($@"\b(?:{w.Pattern})\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))];

    private static readonly Regex[] ProtectedTermRegexes =
        [.. ProtectedTerms.Select(t => new Regex($@"\b(?:{t.Pattern})\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))];

    public static int WordBudgetPerLanguage(int maxWords) => Math.Max(40, maxWords / 2);

    public static NotesCheck Check(string? rawNotes, int wordBudgetPerLanguage)
    {
        var text = ProposalNormalizer.NormalizeNotes(rawNotes);
        var violations = new List<string>();
        var advisories = new List<string>();

        var lines = text.Split('\n');
        var englishAt = FindHeadings(lines, EnglishHeadingRegex());
        var dutchAt = FindHeadings(lines, DutchHeadingRegex());

        string[]? english = null, dutch = null;
        var notes = text;
        if (englishAt.Count == 1 && dutchAt.Count == 1 && englishAt[0] < dutchAt[0])
        {
            english = NonEmpty(lines[(englishAt[0] + 1)..dutchAt[0]]);
            dutch = NonEmpty(lines[(dutchAt[0] + 1)..]);
            var preamble = NonEmpty(lines[..englishAt[0]]);

            if (preamble.Length > 0) violations.Add($"Remove the text before '{EnglishHeading}'; the notes must start with that line.");
            else notes = $"{EnglishHeading}\n{string.Join('\n', english)}\n\n{DutchHeading}\n{string.Join('\n', dutch)}";

            if (english.Length == 0) violations.Add($"The English version is empty; write the English speaker text under '{EnglishHeading}'.");
            if (dutch.Length == 0) violations.Add($"The Dutch version is empty; write the Dutch speaker text under '{DutchHeading}'.");
        }
        else
        {
            violations.Add($"Use exactly two sections: a line '{EnglishHeading}' with the English text, then a blank line, a line '{DutchHeading}' and the Dutch text.");
        }

        var body = english is null ? text : string.Join('\n', english.Concat(dutch!));
        CheckSourceFree(body, violations);

        if (body.Split('\n').Any(l => ListItemRegex().IsMatch(l)))
            violations.Add("Replace bullets and numbered items with plain sentences.");

        foreach (var word in AvoidWordRegexes.SelectMany(r => r.Matches(body)).Select(m => m.Value.ToLowerInvariant()).Distinct())
            violations.Add($"Avoid '{word}' unless it is part of an official product or feature name.");

        if (dutch is { Length: > 0 })
        {
            var dutchText = string.Join('\n', dutch);
            for (var i = 0; i < ProtectedTerms.Length; i++)
            {
                var found = ProtectedTermRegexes[i].Matches(dutchText).Select(m => m.Value).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (found.Count > 0)
                    violations.Add($"The Dutch version translates '{ProtectedTerms[i].Term}' as {string.Join(", ", found.Select(f => $"'{f}'"))}; keep '{ProtectedTerms[i].Term}' in English.");
            }
            if (RetireRegex().IsMatch(dutchText))
                violations.Add("The Dutch version uses 'retire' or 'retirement'; use a natural form of 'uitfaseren'.");
            if (FormalYouRegex().IsMatch(dutchText))
                violations.Add("The Dutch version addresses the audience with 'u' or 'uw'; use 'je' or 'jij'.");
        }

        if (english is not null)
        {
            CheckLength("English", english, wordBudgetPerLanguage, advisories);
            CheckLength("Dutch", dutch!, wordBudgetPerLanguage, advisories);
        }

        var language = english is { Length: > 0 } && dutch is { Length: > 0 } ? Bilingual : "und";
        return new NotesCheck(notes, language, violations, advisories);
    }

    private static void CheckSourceFree(string body, List<string> violations)
    {
        if (UrlRegex().IsMatch(body))
            violations.Add("Remove the URLs; the speaker notes must not contain links.");
        if (CitationMarkerRegex().IsMatch(body))
            violations.Add("Remove the citation markers such as [1]; the speaker notes must not cite sources.");
        if (SourceSectionRegex().IsMatch(body))
            violations.Add("Remove the Sources, References or Learn more section; sources belong in the sources field only.");
        foreach (var phrase in AttributionRegex().Matches(body).Select(m => m.Value.ToLowerInvariant()).Distinct())
            violations.Add($"Remove the attribution '{phrase}'; state the fact directly.");
    }

    private static void CheckLength(string language, string[] lines, int budget, List<string> advisories)
    {
        var text = string.Join(' ', lines);
        var words = SlideAssessor.Words(text).Count;
        if (words > budget)
            advisories.Add($"The {language} version has {words} words; the budget is {budget} per language.");
        var sentences = CountSentences(text);
        if (sentences > MaxSentencesPerLanguage)
            advisories.Add($"The {language} version has {sentences} sentences; the target is 3 to {MaxSentencesPerLanguage}.");
    }

    internal static int CountSentences(string text)
    {
        var withoutAbbreviations = AbbreviationRegex().Replace(text, "");
        return SentenceEndRegex().Matches(withoutAbbreviations).Count + (EndsWithoutPunctuation(withoutAbbreviations) ? 1 : 0);
    }

    private static bool EndsWithoutPunctuation(string text)
    {
        var trimmed = text.TrimEnd();
        return trimmed.Length > 0 && !".!?".Contains(trimmed[^1]);
    }

    private static List<int> FindHeadings(string[] lines, Regex heading) =>
        [.. lines.Select((line, index) => (line, index)).Where(x => heading.IsMatch(x.line)).Select(x => x.index)];

    private static string[] NonEmpty(string[] lines) => [.. lines.Where(l => !string.IsNullOrWhiteSpace(l)).Select(l => l.Trim())];

    [GeneratedRegex(@"^\s*(english version|engelse versie)\s*:?\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex EnglishHeadingRegex();

    [GeneratedRegex(@"^\s*(dutch version|nederlandse versie)\s*:?\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex DutchHeadingRegex();

    [GeneratedRegex(@"https?://|\bwww\.", RegexOptions.IgnoreCase)]
    private static partial Regex UrlRegex();

    [GeneratedRegex(@"\[\^?\s*\d+(\s*[,–-]\s*\d+)*\s*\]|【[^】]*】|\[(source|bron)\s*\d*\]", RegexOptions.IgnoreCase)]
    private static partial Regex CitationMarkerRegex();

    [GeneratedRegex(@"^\s*(sources?|bronnen|references?|referenties|citations?|learn more|meer informatie|lees meer)\s*:", RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex SourceSectionRegex();

    [GeneratedRegex(@"\baccording to (the )?(sources?|microsoft|documentation|docs|article|blog|announcement|release notes?)\b|\bthe (documentation|docs|article|blog|announcement|source|release notes?) (states|explains|mentions|says|notes)\b|\bvolgens (de )?(bronn?en|bron|microsoft|documentatie|blog|artikel|aankondiging|release ?notes?)\b|\bde (documentatie|blog|bron|aankondiging|release ?notes?) (stelt|vermeldt|meldt|zegt|legt uit)\b", RegexOptions.IgnoreCase)]
    private static partial Regex AttributionRegex();

    [GeneratedRegex(@"^\s*(•|\d+[.)]\s)")]
    private static partial Regex ListItemRegex();

    [GeneratedRegex(@"\bretire(ment|s|d)?\b", RegexOptions.IgnoreCase)]
    private static partial Regex RetireRegex();

    [GeneratedRegex(@"\b(u|uw)\b", RegexOptions.IgnoreCase)]
    private static partial Regex FormalYouRegex();

    [GeneratedRegex(@"\b(e\.g\.|i\.e\.|etc\.|vs\.|bijv\.|bv\.|o\.a\.|d\.w\.z\.|m\.b\.v\.|incl\.)", RegexOptions.IgnoreCase)]
    private static partial Regex AbbreviationRegex();

    [GeneratedRegex(@"[.!?]+(?=\s|$)")]
    private static partial Regex SentenceEndRegex();
}
