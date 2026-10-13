using PptxEnricher.Api.Pptx;

namespace PptxEnricher.Api.Tests;

public class PptxReaderTests
{
    [Fact]
    public void Reads_slide_text_structure_and_notes()
    {
        using var stream = TestDeck.Build(
        [
            new TestSlide
            {
                Title = "Azure Firewall update",
                Bullets = [("Auto-learn SNAT routes", 0), ("Generally available in all regions", 1)],
                Table = [["Feature", "Status"], ["SNAT", "GA"]],
                GroupedText = "Grouped callout",
                Link = "https://learn.microsoft.com/azure/firewall/",
                Section = "Networking",
                Notes = ["First line of notes.", "", "Second line."],
            },
        ]);

        var deck = PptxReader.Read(stream, "fallback");
        var slide = Assert.Single(deck.Slides);

        Assert.Equal(1, slide.Number);
        Assert.Equal("Azure Firewall update", slide.Title);
        Assert.Equal("Networking", slide.Section);
        Assert.Equal("Title and Content", slide.LayoutName);
        Assert.Contains(new SlideParagraph("Auto-learn SNAT routes", 0), slide.Paragraphs);
        Assert.Contains(new SlideParagraph("Generally available in all regions", 1), slide.Paragraphs);
        Assert.Contains(slide.Paragraphs, p => p.Text == "Grouped callout");
        Assert.DoesNotContain(slide.Paragraphs, p => p.Text == "7");
        var table = Assert.Single(slide.Tables);
        Assert.Equal(["Feature", "Status"], table.Rows[0]);
        Assert.Equal(["SNAT", "GA"], table.Rows[1]);
        Assert.Equal(["https://learn.microsoft.com/azure/firewall/"], slide.Links);
        Assert.True(slide.HasNotesPart);
        Assert.Equal("First line of notes.\n\nSecond line.", slide.Notes);
    }

    [Fact]
    public void Ignores_slide_number_placeholder_in_notes()
    {
        using var stream = TestDeck.Build([new TestSlide { Title = "Intro", Notes = [] }]);

        var slide = Assert.Single(PptxReader.Read(stream, "fallback").Slides);

        Assert.True(slide.HasNotesPart);
        Assert.Equal("", slide.Notes);
    }

    [Fact]
    public void Handles_slides_without_notes_part_and_hidden_slides_in_presentation_order()
    {
        using var stream = TestDeck.Build(
        [
            new TestSlide { Title = "One", Notes = ["Notes one"] },
            new TestSlide { Title = "Two", Hidden = true },
            new TestSlide { Title = "Three", Notes = ["Notes three"] },
        ]);

        var deck = PptxReader.Read(stream, "fallback");

        Assert.Equal(["One", "Two", "Three"], deck.Slides.Select(s => s.Title));
        Assert.Equal([1, 2, 3], deck.Slides.Select(s => s.Number));
        Assert.False(deck.Slides[1].HasNotesPart);
        Assert.Equal("", deck.Slides[1].Notes);
        Assert.True(deck.Slides[1].Hidden);
        Assert.False(deck.Slides[0].Hidden);
        Assert.Equal("Notes three", deck.Slides[2].Notes);
    }

    [Fact]
    public void Counts_pictures_but_keeps_only_meaningful_alt_text()
    {
        using var stream = TestDeck.Build(
        [
            new TestSlide { Title = "Architecture", PictureDescriptions = ["  Hub and spoke network diagram ", "\"\"", "-", null, "   "] },
        ]);

        var slide = Assert.Single(PptxReader.Read(stream, "fallback").Slides);

        Assert.Equal(5, slide.PictureCount);
        Assert.Equal(["Hub and spoke network diagram"], slide.PictureDescriptions);
    }

    [Theory]
    [InlineData(null, "Opening slide")]
    [InlineData("PowerPoint Presentation", "Opening slide")]
    [InlineData("Quarterly briefing", "Quarterly briefing")]
    public void Deck_title_prefers_meaningful_document_title(string? documentTitle, string expected)
    {
        using var stream = TestDeck.Build([new TestSlide { Title = "Opening slide" }], title: documentTitle);

        Assert.Equal(expected, PptxReader.Read(stream, "fallback").Title);
    }

    [SampleDeckFact]
    public void Reads_sample_deck()
    {
        using var stream = File.OpenRead(TestDeck.FindSampleDeck()!);

        var deck = PptxReader.Read(stream, "sample");

        Assert.NotEmpty(deck.Slides);
        Assert.Equal(Enumerable.Range(1, deck.Slides.Count), deck.Slides.Select(s => s.Number));
        Assert.Contains(deck.Slides, s => !string.IsNullOrWhiteSpace(s.Title));
        Assert.Contains(deck.Slides, s => s.Notes.Length > 0);
        // Slide-number placeholders in notes pages must not leak into the notes text.
        Assert.DoesNotContain(deck.Slides, s => s.Notes.Trim() == s.Number.ToString());
    }
}
