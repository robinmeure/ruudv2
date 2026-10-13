using System.Text;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Presentation;
using A = DocumentFormat.OpenXml.Drawing;
using C = DocumentFormat.OpenXml.Drawing.Charts;
using Dgm = DocumentFormat.OpenXml.Drawing.Diagrams;
using P14 = DocumentFormat.OpenXml.Office2010.PowerPoint;

namespace PptxEnricher.Api.Pptx;

public static class PptxReader
{
    private static readonly HashSet<PlaceholderValues> IgnoredPlaceholders =
    [
        PlaceholderValues.SlideNumber,
        PlaceholderValues.DateAndTime,
        PlaceholderValues.Footer,
        PlaceholderValues.Header,
    ];

    public static DeckContent Read(Stream stream, string fallbackTitle)
    {
        using var document = PresentationDocument.Open(stream, false);
        var presentationPart = document.PresentationPart
            ?? throw new InvalidDataException("The file does not contain a presentation.");

        var sections = ReadSections(presentationPart);
        var slides = new List<SlideContent>();
        var number = 0;
        foreach (var slideId in presentationPart.Presentation?.SlideIdList?.Elements<SlideId>() ?? [])
        {
            number++;
            if (slideId.RelationshipId?.Value is not { } relId) continue;
            var slidePart = (SlidePart)presentationPart.GetPartById(relId);
            sections.TryGetValue(slideId.Id?.Value ?? 0, out var section);
            slides.Add(ReadSlide(slidePart, number, section));
        }

        var title = document.PackageProperties.Title;
        // Many decks keep PowerPoint's default document title; the first slide title is more meaningful.
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Equals("PowerPoint Presentation", StringComparison.OrdinalIgnoreCase))
            title = slides.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s.Title))?.Title ?? fallbackTitle;

        return new DeckContent(title.Trim(), slides);
    }

    private static Dictionary<uint, string> ReadSections(PresentationPart presentationPart)
    {
        var map = new Dictionary<uint, string>();
        if (presentationPart.Presentation is null) return map;
        foreach (var section in presentationPart.Presentation.Descendants<P14.Section>())
        {
            var name = section.Name?.Value;
            if (string.IsNullOrWhiteSpace(name)) continue;
            foreach (var entry in section.Descendants<P14.SectionSlideIdListEntry>())
            {
                if (entry.Id?.Value is { } id) map[id] = name;
            }
        }
        return map;
    }

    private static SlideContent ReadSlide(SlidePart slidePart, int number, string? section)
    {
        var collector = new SlideCollector(slidePart);
        if (slidePart.Slide?.CommonSlideData?.ShapeTree is { } tree)
            collector.Walk(tree);

        var links = slidePart.HyperlinkRelationships
            .Where(r => r.IsExternal)
            .Select(r => r.Uri.ToString())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new SlideContent
        {
            Number = number,
            Title = collector.Title,
            Section = section,
            LayoutName = slidePart.SlideLayoutPart?.SlideLayout?.CommonSlideData?.Name?.Value,
            Hidden = slidePart.Slide?.Show?.Value == false,
            Paragraphs = collector.Paragraphs,
            Tables = collector.Tables,
            PictureCount = collector.PictureCount,
            PictureDescriptions = collector.PictureDescriptions,
            ChartCount = collector.ChartCount,
            ChartTitles = collector.ChartTitles,
            Links = links,
            HasNotesPart = slidePart.NotesSlidePart is not null,
            Notes = ReadNotes(slidePart.NotesSlidePart),
        };
    }

    public static string ReadNotes(NotesSlidePart? notesSlidePart)
    {
        var body = FindNotesBody(notesSlidePart);
        if (body?.TextBody is null) return "";
        var lines = body.TextBody.Elements<A.Paragraph>().Select(ParagraphText);
        return string.Join('\n', lines).Trim();
    }

    internal static Shape? FindNotesBody(NotesSlidePart? notesSlidePart) =>
        notesSlidePart?.NotesSlide?.CommonSlideData?.ShapeTree?
            .Descendants<Shape>()
            .FirstOrDefault(IsNotesBodyPlaceholder);

    internal static bool IsNotesBodyPlaceholder(Shape shape)
    {
        var placeholder = GetPlaceholder(shape);
        if (placeholder is null) return false;
        if (placeholder.Type is null) return placeholder.Index?.Value == 1;
        return placeholder.Type.Value == PlaceholderValues.Body;
    }

    internal static PlaceholderShape? GetPlaceholder(Shape shape) =>
        shape.NonVisualShapeProperties?.ApplicationNonVisualDrawingProperties?.PlaceholderShape;

    internal static string ParagraphText(A.Paragraph paragraph)
    {
        var sb = new StringBuilder();
        foreach (var child in paragraph.ChildElements)
        {
            switch (child)
            {
                case A.Run run:
                    sb.Append(run.Text?.Text);
                    break;
                case A.Field field:
                    sb.Append(field.Text?.Text);
                    break;
                case A.Break:
                    sb.Append('\n');
                    break;
            }
        }
        return sb.ToString();
    }

    private sealed class SlideCollector(SlidePart slidePart)
    {
        public string? Title { get; private set; }
        public List<SlideParagraph> Paragraphs { get; } = [];
        public List<SlideTable> Tables { get; } = [];
        public int PictureCount { get; private set; }
        public List<string> PictureDescriptions { get; } = [];
        public int ChartCount { get; private set; }
        public List<string> ChartTitles { get; } = [];

        public void Walk(OpenXmlElement container)
        {
            foreach (var element in container.ChildElements)
            {
                switch (element)
                {
                    case Shape shape:
                        AddShape(shape);
                        break;
                    case GroupShape group:
                        Walk(group);
                        break;
                    case GraphicFrame frame:
                        AddGraphicFrame(frame);
                        break;
                    case Picture picture:
                        PictureCount++;
                        var description = picture.NonVisualPictureProperties?.NonVisualDrawingProperties?.Description?.Value;
                        // Decks often carry placeholder alt text such as "" or "-"; only keep descriptions that say something.
                        if (description is not null && description.Any(char.IsLetterOrDigit)) PictureDescriptions.Add(description.Trim());
                        break;
                    case AlternateContent alternate:
                        var branch = (OpenXmlElement?)alternate.GetFirstChild<AlternateContentChoice>()
                            ?? alternate.GetFirstChild<AlternateContentFallback>();
                        if (branch is not null) Walk(branch);
                        break;
                }
            }
        }

        private void AddShape(Shape shape)
        {
            var placeholder = GetPlaceholder(shape);
            var placeholderType = placeholder?.Type?.Value;
            if (placeholderType is { } type && IgnoredPlaceholders.Contains(type)) return;
            if (shape.TextBody is null) return;

            var paragraphs = shape.TextBody.Elements<A.Paragraph>()
                .Select(p => new SlideParagraph(Normalize(ParagraphText(p)), p.ParagraphProperties?.Level?.Value ?? 0))
                .Where(p => p.Text.Length > 0)
                .ToList();
            if (paragraphs.Count == 0) return;

            var isTitle = placeholderType is { } t && (t == PlaceholderValues.Title || t == PlaceholderValues.CenteredTitle);
            if (isTitle && Title is null)
            {
                Title = string.Join(' ', paragraphs.Select(p => p.Text));
                return;
            }
            Paragraphs.AddRange(paragraphs);
        }

        private void AddGraphicFrame(GraphicFrame frame)
        {
            var data = frame.Graphic?.GraphicData;
            if (data is null) return;

            if (data.GetFirstChild<A.Table>() is { } table)
            {
                var rows = table.Elements<A.TableRow>()
                    .Select(row => (IReadOnlyList<string>)row.Elements<A.TableCell>()
                        .Select(cell => Normalize(string.Join(' ', cell.TextBody?.Elements<A.Paragraph>().Select(ParagraphText) ?? [])))
                        .ToList())
                    .Where(row => row.Any(c => c.Length > 0))
                    .ToList();
                if (rows.Count > 0) Tables.Add(new SlideTable(rows));
                return;
            }

            if (data.Descendants<C.ChartReference>().FirstOrDefault()?.Id?.Value is { } chartId)
            {
                ChartCount++;
                if (TryGetPart(chartId) is ChartPart chartPart)
                {
                    var titleText = chartPart.ChartSpace?.Descendants<C.Title>().FirstOrDefault()?
                        .Descendants<A.Paragraph>().Select(ParagraphText);
                    var title = Normalize(string.Join(' ', titleText ?? []));
                    if (title.Length > 0) ChartTitles.Add(title);
                }
                return;
            }

            if (data.Descendants<Dgm.RelationshipIds>().FirstOrDefault()?.DataPart?.Value is { } dataId
                && TryGetPart(dataId) is DiagramDataPart diagramPart
                && diagramPart.DataModelRoot is { } root)
            {
                Paragraphs.AddRange(root.Descendants<A.Paragraph>()
                    .Select(p => new SlideParagraph(Normalize(ParagraphText(p)), 0))
                    .Where(p => p.Text.Length > 0));
            }
        }

        private OpenXmlPart? TryGetPart(string relationshipId)
        {
            try { return slidePart.GetPartById(relationshipId); }
            catch (ArgumentOutOfRangeException) { return null; }
        }
    }

    private static string Normalize(string text) =>
        string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
