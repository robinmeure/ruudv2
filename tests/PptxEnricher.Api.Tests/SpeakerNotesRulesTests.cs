using PptxEnricher.Api.Enrichment;

namespace PptxEnricher.Api.Tests;

public class SpeakerNotesRulesTests
{
    private const int Budget = 125;

    private const string CleanNotes =
        "English Version\n" +
        "Until now you had to resize each cluster by hand when demand changed. With this capability, the pipeline adjusts throughput for you.\n" +
        "It is in Public Preview, so check the SLA before you rely on it in production.\n" +
        "\n" +
        "Dutch Version\n" +
        "Tot nu toe moest je elk cluster met de hand aanpassen als de vraag veranderde. Met deze functionaliteit past de pipeline de throughput voor je aan.\n" +
        "Het zit in Public Preview, dus controleer de SLA voordat je er in productie op vertrouwt.";

    [Fact]
    public void Clean_bilingual_notes_pass_unchanged()
    {
        var check = SpeakerNotesRules.Check(CleanNotes, Budget);

        Assert.Equal(CleanNotes, check.Notes);
        Assert.Equal("en+nl", check.Language);
        Assert.Empty(check.Violations);
        Assert.Empty(check.Advisories);
    }

    [Fact]
    public void Puts_headings_and_blank_lines_into_canonical_form()
    {
        var check = SpeakerNotesRules.Check("**English version:**\r\n\r\nLine one.\n\nLine two.\n\n\n## Dutch Version\n\nRegel een.\n", Budget);

        Assert.Equal("English Version\nLine one.\nLine two.\n\nDutch Version\nRegel een.", check.Notes);
        Assert.Empty(check.Violations);
    }

    [Fact]
    public void Flags_citations_urls_attribution_and_source_sections()
    {
        var notes =
            "English Version\nYou can now deploy faster [1]. According to Microsoft, it works in every region.\n" +
            "Sources:\n• Docs – https://learn.microsoft.com/x\n\nDutch Version\nJe kunt nu sneller deployen【2】.";

        var check = SpeakerNotesRules.Check(notes, Budget);

        Assert.Contains(check.Violations, v => v.StartsWith("Remove the URLs", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.StartsWith("Remove the citation markers", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.StartsWith("Remove the Sources", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.Contains("'according to microsoft'", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.StartsWith("Replace bullets", StringComparison.Ordinal));
    }

    [Fact]
    public void Flags_translated_terms_formal_you_and_retire_in_dutch()
    {
        var notes =
            "English Version\nYou can scale in every region.\n\nDutch Version\n" +
            "Met deze schaalbaarheid kunt u de latentie in elke regio verlagen met uw toegangssleutel. " +
            "De retirement volgt later, en het is nu algemeen beschikbaar. Je kunt het ook scalen.";

        var check = SpeakerNotesRules.Check(notes, Budget);

        Assert.Contains(check.Violations, v => v.Contains("translates 'scale' as 'schaalbaarheid', 'scalen'", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.Contains("translates 'latency'", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.Contains("translates 'region' as 'regio'", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.Contains("translates 'key' as 'toegangssleutel'", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.Contains("translates 'generally available'", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.Contains("'u' or 'uw'", StringComparison.Ordinal));
        Assert.Contains(check.Violations, v => v.Contains("uitfaseren", StringComparison.Ordinal));
    }

    [Fact]
    public void Ignores_figurative_dutch_words_and_english_text()
    {
        var notes =
            "English Version\nThe key point is that latency drops in your region.\n\n" +
            "Dutch Version\nDit speelt een sleutelrol, en het weerspiegelt wat je vroeg. De latency daalt in je region.";

        var check = SpeakerNotesRules.Check(notes, Budget);

        Assert.Empty(check.Violations);
    }

    [Fact]
    public void Flags_avoided_words_in_both_languages_but_not_major_version()
    {
        var notes =
            "English Version\nThis powerful, seamless update supports a major version upgrade.\n\n" +
            "Dutch Version\nDeze krachtige update ondersteunt een major version upgrade.";

        var check = SpeakerNotesRules.Check(notes, Budget);

        Assert.Equal(
            ["Avoid 'powerful' unless it is part of an official product or feature name.",
             "Avoid 'seamless' unless it is part of an official product or feature name.",
             "Avoid 'krachtige' unless it is part of an official product or feature name."],
            check.Violations);
    }

    [Theory]
    [InlineData("Just one language.")]
    [InlineData("English Version\nOnly English.")]
    [InlineData("Dutch Version\nAlleen Nederlands.\n\nEnglish Version\nEnglish second.")]
    public void Flags_a_missing_or_misordered_section(string notes)
    {
        var check = SpeakerNotesRules.Check(notes, Budget);

        Assert.Equal("und", check.Language);
        Assert.Contains(check.Violations, v => v.StartsWith("Use exactly two sections", StringComparison.Ordinal));
    }

    [Fact]
    public void Flags_text_before_the_english_heading_and_keeps_it()
    {
        var notes = "Here are your notes:\nEnglish Version\nText.\n\nDutch Version\nTekst.";

        var check = SpeakerNotesRules.Check(notes, Budget);

        Assert.Equal(notes, check.Notes);
        Assert.Contains(check.Violations, v => v.StartsWith("Remove the text before", StringComparison.Ordinal));
    }

    [Fact]
    public void Length_findings_are_advisories_only()
    {
        var english = string.Join(" ", Enumerable.Repeat("You can do this now.", 6));
        var dutch = string.Join(" ", Enumerable.Repeat("Je kunt dit nu doen met een paar extra woorden.", 3));

        var check = SpeakerNotesRules.Check($"English Version\n{english}\n\nDutch Version\n{dutch}", 20);

        Assert.Empty(check.Violations);
        Assert.Equal(
            ["The English version has 30 words; the budget is 20 per language.",
             "The English version has 6 sentences; the target is 3 to 5.",
             "The Dutch version has 30 words; the budget is 20 per language."],
            check.Advisories);
    }

    [Theory]
    [InlineData("Use e.g. Azure Files. It works", 2)]
    [InlineData("Versie 2.5 is er. Bijv. voor jou!", 2)]
    [InlineData("", 0)]
    public void Counts_sentences(string text, int expected) =>
        Assert.Equal(expected, SpeakerNotesRules.CountSentences(text));

    [Fact]
    public void Splits_the_word_budget_over_both_languages() =>
        Assert.Equal(125, SpeakerNotesRules.WordBudgetPerLanguage(250));

    [Fact]
    public void Instructions_list_every_checked_term_and_avoided_word()
    {
        foreach (var (term, _) in SpeakerNotesRules.ProtectedTerms)
            Assert.Contains(term, PromptBuilder.Instructions, StringComparison.OrdinalIgnoreCase);
        foreach (var (word, _) in SpeakerNotesRules.AvoidWords)
            Assert.Contains(word, PromptBuilder.Instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(SpeakerNotesRules.EnglishHeading, PromptBuilder.Instructions, StringComparison.Ordinal);
        Assert.Contains(SpeakerNotesRules.DutchHeading, PromptBuilder.Instructions, StringComparison.Ordinal);
    }
}
