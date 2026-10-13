using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using PptxEnricher.Api.Enrichment;
using PptxEnricher.Api.Pptx;
using PptxEnricher.Api.Storage;

namespace PptxEnricher.Api.Tests;

public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public string StorageRoot { get; } = Path.Combine(Path.GetTempPath(), "PptxEnricherTests", Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Storage:Root", StorageRoot);
        // Nothing listens on port 9; status checks must report "not connected" rather than fail.
        builder.UseSetting("Copilot:CliUrl", "localhost:9");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { Directory.Delete(StorageRoot, recursive: true); } catch (IOException) { }
    }
}

public class ApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private async Task<DeckState> UploadAsync(HttpClient client, MemoryStream deck, string fileName = "briefing.pptx")
    {
        using var content = new MultipartFormDataContent();
        var file = new StreamContent(deck);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.presentationml.presentation");
        content.Add(file, "file", fileName);
        var response = await client.PostAsync("/api/decks", content);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<DeckState>(Json))!;
    }

    private static MemoryStream SampleDeck() => TestDeck.Build(
    [
        new TestSlide { Title = "Briefing" },
        new TestSlide
        {
            Title = "Azure Firewall SNAT",
            Bullets = [("Auto-learn SNAT routes from Azure Route Server is now generally available", 0)],
        },
        new TestSlide { Title = "Existing", Bullets = [("Some content here for the audience", 0)], Notes = ["Keep these notes."] },
    ]);

    [Fact]
    public async Task Upload_assesses_slides_and_lists_deck()
    {
        var client = factory.CreateClient();

        var deck = await UploadAsync(client, SampleDeck());

        Assert.Equal("Briefing", deck.Title);
        Assert.Equal(3, deck.Slides.Count);
        Assert.True(deck.Slides[1].Assessment.Flagged);
        Assert.False(deck.Slides[0].Assessment.Flagged);
        var list = await client.GetFromJsonAsync<List<DeckSummary>>("/api/decks", Json);
        Assert.Contains(list!, d => d.Id == deck.Id && d.FlaggedCount >= 1);
        Assert.True(File.Exists(Path.Combine(factory.StorageRoot, deck.Id, "original.pptx")));
    }

    [Fact]
    public async Task Rejects_non_pptx_uploads()
    {
        var client = factory.CreateClient();
        using var content = new MultipartFormDataContent { { new ByteArrayContent("hello"u8.ToArray()), "file", "notes.txt" } };

        var response = await client.PostAsync("/api/decks", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_corrupt_pptx_uploads()
    {
        var client = factory.CreateClient();
        using var content = new MultipartFormDataContent { { new ByteArrayContent("not a zip"u8.ToArray()), "file", "broken.pptx" } };

        var response = await client.PostAsync("/api/decks", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Accepted_notes_are_written_to_exported_copy_only()
    {
        var client = factory.CreateClient();
        var deck = await UploadAsync(client, SampleDeck());

        var exportBefore = await client.GetAsync($"/api/decks/{deck.Id}/export");
        Assert.Equal(HttpStatusCode.BadRequest, exportBefore.StatusCode);

        var review = await client.PutAsJsonAsync($"/api/decks/{deck.Id}/slides/2/review", new { status = "accepted", notes = "**Enriched** notes\n- with a bullet" });
        review.EnsureSuccessStatusCode();
        var slide = await review.Content.ReadFromJsonAsync<SlideState>(Json);
        Assert.Equal(ReviewStatus.Accepted, slide!.Review);
        Assert.Equal("Enriched notes\n• with a bullet", slide.AcceptedNotes);

        var export = await client.GetAsync($"/api/decks/{deck.Id}/export");
        export.EnsureSuccessStatusCode();
        Assert.Equal("briefing-enriched.pptx", export.Content.Headers.ContentDisposition?.FileNameStar ?? export.Content.Headers.ContentDisposition?.FileName);
        using var exported = new MemoryStream(await export.Content.ReadAsByteArrayAsync());
        var exportedDeck = PptxReader.Read(exported, "x");
        Assert.Equal("Enriched notes\n• with a bullet", exportedDeck.Slides[1].Notes);
        Assert.Equal("Keep these notes.", exportedDeck.Slides[2].Notes);

        using var original = File.OpenRead(Path.Combine(factory.StorageRoot, deck.Id, "original.pptx"));
        Assert.Equal("", PptxReader.Read(original, "x").Slides[1].Notes);
    }

    [Fact]
    public async Task Export_preserves_order_hidden_flags_original_and_unaccepted_notes()
    {
        var client = factory.CreateClient();
        var deck = await UploadAsync(client, TestDeck.Build(
        [
            new TestSlide { Title = "First", Notes = ["Original first"] },
            new TestSlide { Title = "Hidden second", Hidden = true, Notes = ["Keep rejected notes"] },
            new TestSlide { Title = "Third", Notes = ["Keep pending notes"] },
        ]));
        var originalPath = Path.Combine(factory.StorageRoot, deck.Id, "original.pptx");
        var originalBytes = await File.ReadAllBytesAsync(originalPath);
        (await client.PutAsJsonAsync($"/api/decks/{deck.Id}/slides/1/review", new { status = "accepted", notes = "Accepted first" })).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/api/decks/{deck.Id}/slides/2/review", new { status = "rejected" })).EnsureSuccessStatusCode();
        (await client.PutAsJsonAsync($"/api/decks/{deck.Id}/slides/3/review", new { status = "pending" })).EnsureSuccessStatusCode();

        var response = await client.GetAsync($"/api/decks/{deck.Id}/export");
        response.EnsureSuccessStatusCode();
        using var exported = new MemoryStream(await response.Content.ReadAsByteArrayAsync());
        var result = PptxReader.Read(exported, "x");

        Assert.Equal(new[] { "First", "Hidden second", "Third" }, result.Slides.Select(s => s.Title));
        Assert.Equal(new[] { false, true, false }, result.Slides.Select(s => s.Hidden));
        Assert.Equal(new[] { "Accepted first", "Keep rejected notes", "Keep pending notes" }, result.Slides.Select(s => s.Notes));
        Assert.Equal(originalBytes, await File.ReadAllBytesAsync(originalPath));
    }

    [Fact]
    public async Task Review_validates_input()
    {
        var client = factory.CreateClient();
        var deck = await UploadAsync(client, SampleDeck());

        var empty = await client.PutAsJsonAsync($"/api/decks/{deck.Id}/slides/2/review", new { status = "accepted", notes = "  " });
        var badStatus = await client.PutAsJsonAsync($"/api/decks/{deck.Id}/slides/2/review", new { status = "maybe" });
        var missingSlide = await client.PutAsJsonAsync($"/api/decks/{deck.Id}/slides/99/review", new { status = "rejected" });

        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badStatus.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missingSlide.StatusCode);
    }

    [Fact]
    public async Task Enrich_rejects_out_of_range_slides_and_skips_when_nothing_flagged()
    {
        var client = factory.CreateClient();
        var deck = await UploadAsync(client, TestDeck.Build([new TestSlide { Title = "Only a title" }]));

        var invalid = await client.PostAsJsonAsync($"/api/decks/{deck.Id}/enrich", new { slides = new[] { 0, 5 } });
        var flagged = await client.PostAsJsonAsync($"/api/decks/{deck.Id}/enrich", new { });

        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        flagged.EnsureSuccessStatusCode();
        var job = await flagged.Content.ReadFromJsonAsync<EnrichmentJobInfo>(Json);
        Assert.Empty(job!.Slides);
    }

    [Fact]
    public async Task Delete_removes_deck()
    {
        var client = factory.CreateClient();
        var deck = await UploadAsync(client, SampleDeck());

        var delete = await client.DeleteAsync($"/api/decks/{deck.Id}");
        var get = await client.GetAsync($"/api/decks/{deck.Id}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        Assert.False(Directory.Exists(Path.Combine(factory.StorageRoot, deck.Id)));
    }

    [Fact]
    public async Task Copilot_status_reports_unreachable_cli()
    {
        var client = factory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(60);

        var status = await client.GetFromJsonAsync<CopilotStatus>("/api/copilot/status", Json);

        Assert.False(status!.Connected);
        Assert.Equal("localhost:9", status.CliUrl);
        Assert.False(string.IsNullOrEmpty(status.Error));
    }
}
