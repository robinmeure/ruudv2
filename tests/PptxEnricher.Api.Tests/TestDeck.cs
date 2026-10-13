using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Presentation;
using A = DocumentFormat.OpenXml.Drawing;
using P14 = DocumentFormat.OpenXml.Office2010.PowerPoint;

namespace PptxEnricher.Api.Tests;

public sealed record TestSlide
{
    public string? Title { get; init; }
    public (string Text, int Level)[] Bullets { get; init; } = [];
    public string[][]? Table { get; init; }
    public string? GroupedText { get; init; }
    public string? Link { get; init; }
    public bool Hidden { get; init; }
    public string? Section { get; init; }
    public string? LayoutName { get; init; }

    /// <summary>Alt text of pictures on the slide; null entries are pictures without a description.</summary>
    public string?[] PictureDescriptions { get; init; } = [];

    /// <summary>Lines of the notes body; null means the slide has no notes part at all.</summary>
    /// <summary>Lines of the notes body; null means the slide has no notes part at all.</summary>
    public string[]? Notes { get; init; }
}

/// <summary>Builds small but structurally realistic .pptx files for tests.</summary>
public static class TestDeck
{
    private const string SectionExtensionUri = "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}";

    public static MemoryStream Build(IReadOnlyList<TestSlide> slides, bool includeNotesMaster = true, string? title = null)
    {
        var stream = new MemoryStream();
        using (var document = PresentationDocument.Create(stream, PresentationDocumentType.Presentation))
        {
            if (title is not null) document.PackageProperties.Title = title;
            var presentationPart = document.AddPresentationPart();
            presentationPart.Presentation = new Presentation();

            var masterPart = presentationPart.AddNewPart<SlideMasterPart>();
            var layouts = new Dictionary<string, SlideLayoutPart>();
            SlideLayoutPart GetLayout(string name)
            {
                if (layouts.TryGetValue(name, out var existing)) return existing;
                var layoutPart = masterPart.AddNewPart<SlideLayoutPart>();
                layoutPart.SlideLayout = new SlideLayout(new CommonSlideData(EmptyTree()) { Name = name });
                layoutPart.AddPart(masterPart);
                layouts[name] = layoutPart;
                return layoutPart;
            }
            GetLayout("Title and Content");

            masterPart.SlideMaster = new SlideMaster(
                new CommonSlideData(EmptyTree()),
                ColorMap(),
                new SlideLayoutIdList(layouts.Values.Select((l, i) => new SlideLayoutId
                {
                    Id = 2147483649U + (uint)i,
                    RelationshipId = masterPart.GetIdOfPart(l),
                })));

            presentationPart.Presentation.Append(new SlideMasterIdList(new SlideMasterId
            {
                Id = 2147483648U,
                RelationshipId = presentationPart.GetIdOfPart(masterPart),
            }));

            NotesMasterPart? notesMasterPart = null;
            if (includeNotesMaster)
            {
                notesMasterPart = presentationPart.AddNewPart<NotesMasterPart>();
                notesMasterPart.NotesMaster = new NotesMaster(new CommonSlideData(EmptyTree()), ColorMap());
                presentationPart.Presentation.Append(new NotesMasterIdList(new NotesMasterId
                {
                    Id = presentationPart.GetIdOfPart(notesMasterPart),
                }));
            }

            var slideIdList = new SlideIdList();
            var sections = new List<(string Name, List<uint> Ids)>();
            uint slideId = 256;
            foreach (var spec in slides)
            {
                var slidePart = presentationPart.AddNewPart<SlidePart>();
                slidePart.Slide = BuildSlide(slidePart, spec);
                slidePart.AddPart(GetLayout(spec.LayoutName ?? "Title and Content"));

                if (spec.Notes is not null)
                {
                    var notesPart = slidePart.AddNewPart<NotesSlidePart>();
                    notesPart.NotesSlide = BuildNotes(spec.Notes, slideIdList.ChildElements.Count + 1);
                    notesPart.AddPart(slidePart);
                    if (notesMasterPart is not null) notesPart.AddPart(notesMasterPart);
                }

                slideIdList.Append(new SlideId { Id = slideId, RelationshipId = presentationPart.GetIdOfPart(slidePart) });
                if (spec.Section is not null)
                {
                    if (sections.Count == 0 || sections[^1].Name != spec.Section) sections.Add((spec.Section, []));
                    sections[^1].Ids.Add(slideId);
                }
                slideId++;
            }

            presentationPart.Presentation.Append(
                slideIdList,
                new SlideSize { Cx = 12192000, Cy = 6858000 },
                new NotesSize { Cx = 6858000, Cy = 9144000 });

            if (sections.Count > 0)
            {
                var sectionList = new P14.SectionList(sections.Select(s => new P14.Section(
                    new P14.SectionSlideIdList(s.Ids.Select(id => new P14.SectionSlideIdListEntry { Id = id })))
                {
                    Name = s.Name,
                    Id = "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}",
                }));
                presentationPart.Presentation.Append(new PresentationExtensionList(
                    new PresentationExtension(sectionList) { Uri = SectionExtensionUri }));
            }

            // Layouts may have been added while building slides; keep the master's layout list complete.
            masterPart.SlideMaster.SlideLayoutIdList = new SlideLayoutIdList(layouts.Values.Select((l, i) => new SlideLayoutId
            {
                Id = 2147483649U + (uint)i,
                RelationshipId = masterPart.GetIdOfPart(l),
            }));
        }

        stream.Position = 0;
        return stream;
    }

    private static Slide BuildSlide(SlidePart slidePart, TestSlide spec)
    {
        var tree = EmptyTree();
        uint id = 2;
        if (spec.Title is not null)
            tree.Append(TextShape(id++, "Title", new PlaceholderShape { Type = PlaceholderValues.Title }, (spec.Title, 0)));

        if (spec.Bullets.Length > 0 || spec.Link is not null)
        {
            var body = TextShape(id++, "Content", new PlaceholderShape { Index = 1U }, spec.Bullets);
            if (spec.Link is not null)
            {
                var rel = slidePart.AddHyperlinkRelationship(new Uri(spec.Link), true);
                body.TextBody!.Append(new A.Paragraph(new A.Run(
                    new A.RunProperties(new A.HyperlinkOnClick { Id = rel.Id }),
                    new A.Text("More info"))));
            }
            tree.Append(body);
        }

        if (spec.GroupedText is not null)
        {
            tree.Append(new GroupShape(
                new NonVisualGroupShapeProperties(
                    new NonVisualDrawingProperties { Id = id++, Name = "Group" },
                    new NonVisualGroupShapeDrawingProperties(),
                    new ApplicationNonVisualDrawingProperties()),
                new GroupShapeProperties(new A.TransformGroup()),
                TextShape(id++, "Grouped", null, (spec.GroupedText, 0))));
        }

        if (spec.Table is not null)
            tree.Append(TableFrame(id++, spec.Table));

        // The reader only looks at a picture's non-visual properties, so no image part is needed.
        foreach (var description in spec.PictureDescriptions)
        {
            tree.Append(new Picture(
                new NonVisualPictureProperties(
                    new NonVisualDrawingProperties { Id = id++, Name = "Picture", Description = description },
                    new NonVisualPictureDrawingProperties(),
                    new ApplicationNonVisualDrawingProperties()),
                new BlipFill(new A.Blip(), new A.Stretch(new A.FillRectangle())),
                new ShapeProperties()));
        }

        // Slide number placeholders must never be treated as content.
        tree.Append(TextShape(id, "Slide Number", new PlaceholderShape { Type = PlaceholderValues.SlideNumber, Index = 12U }, ("7", 0)));

        var slide = new Slide(new CommonSlideData(tree), new ColorMapOverride(new A.MasterColorMapping()));
        if (spec.Hidden) slide.Show = false;
        return slide;
    }

    private static NotesSlide BuildNotes(string[] lines, int slideNumber)
    {
        var tree = EmptyTree();
        tree.Append(
            new Shape(
                new NonVisualShapeProperties(
                    new NonVisualDrawingProperties { Id = 2U, Name = "Slide Image Placeholder 1" },
                    new NonVisualShapeDrawingProperties(),
                    new ApplicationNonVisualDrawingProperties(new PlaceholderShape { Type = PlaceholderValues.SlideImage })),
                new ShapeProperties()),
            TextShape(3U, "Notes Placeholder 2", new PlaceholderShape { Type = PlaceholderValues.Body, Index = 1U },
                lines.Select(l => (l, 0)).ToArray()),
            TextShape(4U, "Slide Number Placeholder 3", new PlaceholderShape { Type = PlaceholderValues.SlideNumber, Index = 5U },
                (slideNumber.ToString(), 0)));
        return new NotesSlide(new CommonSlideData(tree), new ColorMapOverride(new A.MasterColorMapping()));
    }

    private static Shape TextShape(uint id, string name, PlaceholderShape? placeholder, params (string Text, int Level)[] paragraphs)
    {
        var appProperties = placeholder is null
            ? new ApplicationNonVisualDrawingProperties()
            : new ApplicationNonVisualDrawingProperties(placeholder);
        var textBody = new TextBody(new A.BodyProperties(), new A.ListStyle());
        foreach (var (text, level) in paragraphs)
        {
            var paragraph = new A.Paragraph();
            if (level > 0) paragraph.Append(new A.ParagraphProperties { Level = level });
            paragraph.Append(new A.Run(new A.RunProperties { Language = "en-US" }, new A.Text(text)));
            textBody.Append(paragraph);
        }
        if (paragraphs.Length == 0) textBody.Append(new A.Paragraph());

        return new Shape(
            new NonVisualShapeProperties(
                new NonVisualDrawingProperties { Id = id, Name = name },
                new NonVisualShapeDrawingProperties(),
                appProperties),
            new ShapeProperties(),
            textBody);
    }

    private static GraphicFrame TableFrame(uint id, string[][] rows)
    {
        var columns = rows.Max(r => r.Length);
        var table = new A.Table(
            new A.TableProperties(),
            new A.TableGrid(Enumerable.Range(0, columns).Select(_ => new A.GridColumn { Width = 1000000 })));
        foreach (var row in rows)
        {
            table.Append(new A.TableRow(row.Select(cell => new A.TableCell(
                new A.TextBody(new A.BodyProperties(), new A.ListStyle(), new A.Paragraph(new A.Run(new A.Text(cell)))),
                new A.TableCellProperties())))
            { Height = 370840 });
        }

        return new GraphicFrame(
            new NonVisualGraphicFrameProperties(
                new NonVisualDrawingProperties { Id = id, Name = "Table" },
                new NonVisualGraphicFrameDrawingProperties(),
                new ApplicationNonVisualDrawingProperties()),
            new Transform(new A.Offset { X = 0, Y = 0 }, new A.Extents { Cx = 1000000L * columns, Cy = 370840L * rows.Length }),
            new A.Graphic(new A.GraphicData(table) { Uri = "http://schemas.openxmlformats.org/drawingml/2006/table" }));
    }

    private static ShapeTree EmptyTree() => new(
        new NonVisualGroupShapeProperties(
            new NonVisualDrawingProperties { Id = 1U, Name = "" },
            new NonVisualGroupShapeDrawingProperties(),
            new ApplicationNonVisualDrawingProperties()),
        new GroupShapeProperties(new A.TransformGroup()));

    private static ColorMap ColorMap() => new()
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
    };

    /// <summary>Finds a .pptx in the repository root (next to PptxEnricher.slnx), if one is present.</summary>
    public static string? FindSampleDeck()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (!File.Exists(Path.Combine(directory.FullName, "PptxEnricher.slnx"))) continue;
            return directory.EnumerateFiles("*.pptx").OrderByDescending(f => f.Length).FirstOrDefault()?.FullName;
        }
        return null;
    }
}

/// <summary>A fact that is skipped when no sample .pptx is present in the repository root.</summary>
public sealed class SampleDeckFactAttribute : FactAttribute
{
    public SampleDeckFactAttribute()
    {
        if (TestDeck.FindSampleDeck() is null) Skip = "No sample .pptx found in the repository root.";
    }
}
