using PptxEnricher.Api.Assessment;
using PptxEnricher.Api.Pptx;

namespace PptxEnricher.Api.Tests;

public class SlideAssessorTests
{
    private static SlideContent Content(string title, string body, string notes = "", int number = 5, bool hidden = false, string? layout = null) => new()
    {
        Number = number,
        Title = title,
        LayoutName = layout,
        Hidden = hidden,
        Paragraphs = body.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(t => new SlideParagraph(t, 0)).ToList(),
        Notes = notes,
        HasNotesPart = notes.Length > 0,
    };

    private const string ContentBody = """
        Azure Firewall can automatically learn SNAT private ranges from Azure Route Server
        This removes manual configuration of private address prefixes for hub networks
        Customers with forced tunneling benefit most from the integration
        """;

    [Fact]
    public void Content_slide_without_notes_is_flagged_with_high_priority()
    {
        var result = SlideAssessor.Assess(Content("Azure Firewall SNAT routes", ContentBody));

        Assert.Equal(SlideKind.Content, result.Kind);
        Assert.Equal(NotesStatus.Missing, result.NotesStatus);
        Assert.True(result.Flagged);
        Assert.False(result.SuggestSkip);
        Assert.True(result.Priority >= 60);
        Assert.Contains("No speaker notes.", result.Reasons);
    }

    [Fact]
    public void Thin_notes_are_flagged()
    {
        var result = SlideAssessor.Assess(Content("Azure Firewall SNAT routes", ContentBody, "Talk about the firewall."));

        Assert.Equal(NotesStatus.Thin, result.NotesStatus);
        Assert.True(result.Flagged);
    }

    [Fact]
    public void Rich_notes_with_good_coverage_are_not_flagged()
    {
        var notes = string.Join(' ', Enumerable.Repeat(
            "Azure Firewall can automatically learn SNAT private ranges from Azure Route Server, which removes manual configuration of private address prefixes for hub networks; customers with forced tunneling benefit most from this integration.",
            2));

        var result = SlideAssessor.Assess(Content("Azure Firewall SNAT routes", ContentBody, notes));

        Assert.Equal(NotesStatus.Ok, result.NotesStatus);
        Assert.True(result.Coverage >= 0.8);
        Assert.False(result.TimeSensitive);
        Assert.False(result.Flagged);
    }

    [Fact]
    public void Time_sensitive_slide_without_sources_is_flagged_even_with_good_notes()
    {
        const string body = "Basic SKU public IP addresses retire on September 30, 2025\nUpgrade to Standard SKU before the retirement date";
        var notes = string.Join(' ', Enumerable.Repeat("Basic SKU public IP addresses retire on September 30 2025 so customers must upgrade to the Standard SKU before the retirement date to avoid disruption.", 3));

        var withoutSources = SlideAssessor.Assess(Content("Retirement: Basic SKU public IPs", body, notes));
        var withSources = SlideAssessor.Assess(Content("Retirement: Basic SKU public IPs", body, notes + " https://learn.microsoft.com/azure/virtual-network/ip-services/public-ip-basic-upgrade-guidance"));

        Assert.True(withoutSources.TimeSensitive);
        Assert.True(withoutSources.Flagged);
        Assert.False(withSources.Flagged);
        Assert.True(withSources.NotesHaveSources);
    }

    [Theory]
    [InlineData("Agenda", SlideKind.Agenda)]
    [InlineData("Q&A", SlideKind.Closing)]
    [InlineData("Thank you!", SlideKind.Closing)]
    [InlineData("Terms and Conditions", SlideKind.Legal)]
    public void Structural_slides_suggest_skipping(string title, SlideKind expected)
    {
        var result = SlideAssessor.Assess(Content(title, ""));

        Assert.Equal(expected, result.Kind);
        Assert.True(result.SuggestSkip);
        Assert.False(result.Flagged);
    }

    [Fact]
    public void First_slide_is_title_slide()
    {
        var result = SlideAssessor.Assess(Content("Technical Update Briefing", "October 2026", number: 1));

        Assert.Equal(SlideKind.Title, result.Kind);
        Assert.True(result.SuggestSkip);
    }

    [Fact]
    public void Hidden_slides_suggest_skipping()
    {
        var result = SlideAssessor.Assess(Content("Azure Firewall SNAT routes", ContentBody, hidden: true));

        Assert.True(result.SuggestSkip);
        Assert.False(result.Flagged);
    }

    [Theory]
    [InlineData("Click to add notes")]
    [InlineData("12")]
    public void Placeholder_notes_are_recognised(string notes)
    {
        var result = SlideAssessor.Assess(Content("Azure Firewall SNAT routes", ContentBody, notes));

        Assert.Equal(NotesStatus.PlaceholderOnly, result.NotesStatus);
        Assert.True(result.Flagged);
    }

    [Fact]
    public void English_modal_may_is_not_time_sensitive()
    {
        var result = SlideAssessor.Assess(Content("Choosing a database", "You may choose relational or document storage\nPick the model that fits your access patterns"));

        Assert.False(result.TimeSensitive);
    }
}
