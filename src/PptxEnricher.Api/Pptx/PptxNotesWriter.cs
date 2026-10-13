using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Presentation;
using A = DocumentFormat.OpenXml.Drawing;

namespace PptxEnricher.Api.Pptx;

public static class PptxNotesWriter
{
    /// <summary>
    /// Writes speaker notes into the presentation in <paramref name="stream"/> (must be read/write and seekable).
    /// Keys are 1-based slide numbers in presentation order.
    /// </summary>
    public static void ApplyNotes(Stream stream, IReadOnlyDictionary<int, string> notesBySlideNumber)
    {
        if (notesBySlideNumber.Count == 0) return;

        using var document = PresentationDocument.Open(stream, true);
        var presentationPart = document.PresentationPart
            ?? throw new InvalidDataException("The file does not contain a presentation.");

        var slideIds = presentationPart.Presentation?.SlideIdList?.Elements<SlideId>().ToList() ?? [];
        foreach (var (number, notes) in notesBySlideNumber)
        {
            if (number < 1 || number > slideIds.Count)
                throw new ArgumentOutOfRangeException(nameof(notesBySlideNumber), $"Slide {number} does not exist.");
            var relId = slideIds[number - 1].RelationshipId?.Value
                ?? throw new InvalidDataException($"Slide {number} has no relationship id.");
            var slidePart = (SlidePart)presentationPart.GetPartById(relId);
            SetNotes(presentationPart, slidePart, notes);
        }

        presentationPart.Presentation!.Save();
    }

    private static void SetNotes(PresentationPart presentationPart, SlidePart slidePart, string notes)
    {
        var notesSlidePart = slidePart.NotesSlidePart ?? CreateNotesSlide(presentationPart, slidePart);
        var notesSlide = notesSlidePart.NotesSlide ??= CreateNotesSlideElement();
        var shapeTree = notesSlide.CommonSlideData?.ShapeTree
            ?? throw new InvalidDataException("Notes slide has no shape tree.");

        var body = PptxReader.FindNotesBody(notesSlidePart);
        if (body is null)
        {
            body = CreateBodyPlaceholder(NextShapeId(shapeTree));
            shapeTree.Append(body);
        }

        var textBody = body.TextBody;
        if (textBody is null)
        {
            textBody = new TextBody(new A.BodyProperties(), new A.ListStyle());
            body.Append(textBody);
        }

        var templateRunProperties = textBody.Descendants<A.RunProperties>().FirstOrDefault();
        textBody.RemoveAllChildren<A.Paragraph>();
        foreach (var line in SplitLines(notes))
            textBody.Append(CreateParagraph(line, templateRunProperties));

        notesSlide.Save();
    }

    private static IEnumerable<string> SplitLines(string notes)
    {
        var lines = notes.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        return lines.Length == 0 ? [""] : lines;
    }

    private static A.Paragraph CreateParagraph(string line, A.RunProperties? template)
    {
        if (line.Length == 0)
            return new A.Paragraph(new A.EndParagraphRunProperties { Language = template?.Language?.Value });

        var runProperties = new A.RunProperties { Dirty = false };
        if (template?.Language?.Value is { } lang) runProperties.Language = lang;
        return new A.Paragraph(new A.Run(runProperties, new A.Text(line)));
    }

    private static NotesSlidePart CreateNotesSlide(PresentationPart presentationPart, SlidePart slidePart)
    {
        var notesMasterPart = presentationPart.NotesMasterPart ?? CreateNotesMaster(presentationPart);
        var notesSlidePart = slidePart.AddNewPart<NotesSlidePart>();
        notesSlidePart.NotesSlide = CreateNotesSlideElement();
        notesSlidePart.AddPart(notesMasterPart);
        notesSlidePart.AddPart(slidePart);
        return notesSlidePart;
    }

    private static NotesSlide CreateNotesSlideElement() =>
        new(
            new CommonSlideData(
                new ShapeTree(
                    GroupProperties(),
                    new GroupShapeProperties(new A.TransformGroup()),
                    CreateSlideImagePlaceholder(2),
                    CreateBodyPlaceholder(3))),
            new ColorMapOverride(new A.MasterColorMapping()));

    private static NonVisualGroupShapeProperties GroupProperties() =>
        new(
            new NonVisualDrawingProperties { Id = 1U, Name = "" },
            new NonVisualGroupShapeDrawingProperties(),
            new ApplicationNonVisualDrawingProperties());

    private static Shape CreateSlideImagePlaceholder(uint id) =>
        new(
            new NonVisualShapeProperties(
                new NonVisualDrawingProperties { Id = id, Name = "Slide Image Placeholder" },
                new NonVisualShapeDrawingProperties(new A.ShapeLocks { NoGrouping = true, NoRotation = true, NoChangeAspect = true }),
                new ApplicationNonVisualDrawingProperties(new PlaceholderShape { Type = PlaceholderValues.SlideImage })),
            new ShapeProperties());

    private static Shape CreateBodyPlaceholder(uint id) =>
        new(
            new NonVisualShapeProperties(
                new NonVisualDrawingProperties { Id = id, Name = "Notes Placeholder" },
                new NonVisualShapeDrawingProperties(new A.ShapeLocks { NoGrouping = true }),
                new ApplicationNonVisualDrawingProperties(new PlaceholderShape { Type = PlaceholderValues.Body, Index = 1U })),
            new ShapeProperties(),
            new TextBody(new A.BodyProperties(), new A.ListStyle(), new A.Paragraph(new A.EndParagraphRunProperties())));

    private static uint NextShapeId(ShapeTree tree)
    {
        var max = tree.Descendants<NonVisualDrawingProperties>().Select(p => p.Id?.Value ?? 0U).DefaultIfEmpty(0U).Max();
        return max + 1;
    }

    private static NotesMasterPart CreateNotesMaster(PresentationPart presentationPart)
    {
        var notesMasterPart = presentationPart.AddNewPart<NotesMasterPart>();
        notesMasterPart.NotesMaster = new NotesMaster(
            new CommonSlideData(
                new ShapeTree(
                    GroupProperties(),
                    new GroupShapeProperties(new A.TransformGroup()),
                    CreateSlideImagePlaceholder(2),
                    CreateBodyPlaceholder(3))),
            new ColorMap
            {
                Background1 = A.ColorSchemeIndexValues.Light1,
                Text1 = A.ColorSchemeIndexValues.Dark1,
                Background2 = A.ColorSchemeIndexValues.Light2,
                Text2 = A.ColorSchemeIndexValues.Dark2,
                Accent1 = A.ColorSchemeIndexValues.Accent1,
                Accent2 = A.ColorSchemeIndexValues.Accent2,
                Accent3 = A.ColorSchemeIndexValues.Accent3,
                Accent4 = A.ColorSchemeIndexValues.Accent4,
                Accent5 = A.ColorSchemeIndexValues.Accent5,
                Accent6 = A.ColorSchemeIndexValues.Accent6,
                Hyperlink = A.ColorSchemeIndexValues.Hyperlink,
                FollowedHyperlink = A.ColorSchemeIndexValues.FollowedHyperlink,
            });

        var masterTheme = presentationPart.SlideMasterParts.FirstOrDefault()?.ThemePart ?? presentationPart.ThemePart;
        if (masterTheme is not null)
        {
            var themePart = notesMasterPart.AddNewPart<ThemePart>();
            using var source = masterTheme.GetStream(FileMode.Open, FileAccess.Read);
            themePart.FeedData(source);
        }

        var presentation = presentationPart.Presentation!;
        var notesMasterIdList = new NotesMasterIdList(
            new NotesMasterId { Id = presentationPart.GetIdOfPart(notesMasterPart) });
        if (presentation.SlideMasterIdList is { } slideMasters)
            presentation.InsertAfter(notesMasterIdList, slideMasters);
        else
            presentation.PrependChild(notesMasterIdList);

        return notesMasterPart;
    }
}
