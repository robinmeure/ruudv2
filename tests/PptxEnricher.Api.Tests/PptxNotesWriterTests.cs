using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using PptxEnricher.Api.Pptx;

namespace PptxEnricher.Api.Tests;

public class PptxNotesWriterTests
{
    [Fact]
    public void Replaces_existing_notes_and_keeps_other_slides_unchanged()
    {
        using var stream = TestDeck.Build(
        [
            new TestSlide { Title = "One", Notes = ["Old notes"] },
            new TestSlide { Title = "Two", Notes = ["Keep me"] },
        ]);

        PptxNotesWriter.ApplyNotes(stream, new Dictionary<int, string> { [1] = "New notes\n\n• Point" });

        stream.Position = 0;
        var deck = PptxReader.Read(stream, "x");
        Assert.Equal("New notes\n\n• Point", deck.Slides[0].Notes);
        Assert.Equal("Keep me", deck.Slides[1].Notes);
        AssertNoNotesValidationErrors(stream);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Creates_notes_for_slide_without_notes_part(bool includeNotesMaster)
    {
        using var stream = TestDeck.Build([new TestSlide { Title = "Bare slide" }], includeNotesMaster);

        PptxNotesWriter.ApplyNotes(stream, new Dictionary<int, string> { [1] = "Fresh notes" });

        stream.Position = 0;
        using (var document = PresentationDocument.Open(stream, false))
        {
            Assert.NotNull(document.PresentationPart!.NotesMasterPart);
            Assert.NotNull(document.PresentationPart.Presentation!.NotesMasterIdList);
            var slidePart = document.PresentationPart.SlideParts.Single();
            Assert.NotNull(slidePart.NotesSlidePart);
            Assert.Same(slidePart, slidePart.NotesSlidePart!.SlidePart);
        }

        stream.Position = 0;
        Assert.Equal("Fresh notes", PptxReader.Read(stream, "x").Slides[0].Notes);
        AssertNoNotesValidationErrors(stream);
    }

    [Fact]
    public void Rejects_unknown_slide_number()
    {
        using var stream = TestDeck.Build([new TestSlide { Title = "Only" }]);

        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PptxNotesWriter.ApplyNotes(stream, new Dictionary<int, string> { [2] = "nope" }));
    }

    [SampleDeckFact]
    public void Round_trips_notes_on_sample_deck()
    {
        using var stream = new MemoryStream();
        using (var file = File.OpenRead(TestDeck.FindSampleDeck()!)) file.CopyTo(stream);
        stream.Position = 0;
        var before = PptxReader.Read(stream, "sample");
        var target = before.Slides.FirstOrDefault(s => !s.HasNotesPart)
            ?? before.Slides.FirstOrDefault(s => s.Notes.Length == 0)
            ?? before.Slides[0];
        var other = before.Slides.Last(s => s.Notes.Length > 0 && s.Number != target.Number);

        stream.Position = 0;
        PptxNotesWriter.ApplyNotes(stream, new Dictionary<int, string>
        {
            [target.Number] = "Enriched notes for the target slide.",
            [other.Number] = "Replaced notes.\n• With a bullet",
        });

        stream.Position = 0;
        var after = PptxReader.Read(stream, "sample");
        Assert.Equal(before.Slides.Count, after.Slides.Count);
        Assert.Equal(before.Slides.Select(s => (s.Number, s.Title, s.Hidden)), after.Slides.Select(s => (s.Number, s.Title, s.Hidden)));
        Assert.Equal("Enriched notes for the target slide.", after.Slides[target.Number - 1].Notes);
        Assert.Equal("Replaced notes.\n• With a bullet", after.Slides[other.Number - 1].Notes);
        foreach (var slide in before.Slides.Where(s => s.Number != target.Number && s.Number != other.Number))
            Assert.Equal(slide.Notes, after.Slides[slide.Number - 1].Notes);
    }

    private static void AssertNoNotesValidationErrors(Stream stream)
    {
        stream.Position = 0;
        using var document = PresentationDocument.Open(stream, false);
        var errors = new OpenXmlValidator()
            .Validate(document)
            .Where(e => e.Part is NotesSlidePart or NotesMasterPart or PresentationPart)
            .Select(e => $"{e.Part?.Uri}: {e.Description}")
            .ToList();
        Assert.Empty(errors);
    }
}
