using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Options;
using PptxEnricher.Api.Assessment;
using PptxEnricher.Api.Pptx;

namespace PptxEnricher.Api.Storage;

public sealed class StorageOptions
{
    public string? Root { get; set; }
}

/// <summary>
/// Keeps deck state in memory and mirrors it to disk (original.pptx + state.json per deck) so work survives restarts.
/// </summary>
public sealed class DeckStore
{
    private const string OriginalFileName = "original.pptx";
    private const string StateFileName = "state.json";
    public const int MaxActivityEntries = 120;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = false };

    private readonly ConcurrentDictionary<string, Entry> _decks = new();
    private readonly ILogger<DeckStore> _logger;
    private readonly TimeProvider _time;

    public DeckStore(IOptions<StorageOptions> options, TimeProvider time, ILogger<DeckStore> logger)
    {
        _logger = logger;
        _time = time;
        Root = string.IsNullOrWhiteSpace(options.Value.Root)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PptxEnricher", "decks")
            : options.Value.Root;
        Directory.CreateDirectory(Root);
        LoadExisting();
    }

    public string Root { get; }

    public async Task<DeckState> CreateAsync(string fileName, Stream content, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid().ToString("N");
        var directory = Path.Combine(Root, id);
        Directory.CreateDirectory(directory);
        var originalPath = Path.Combine(directory, OriginalFileName);

        try
        {
            await using (var file = File.Create(originalPath))
                await content.CopyToAsync(file, cancellationToken);

            DeckContent deck;
            await using (var file = File.OpenRead(originalPath))
                deck = PptxReader.Read(file, Path.GetFileNameWithoutExtension(fileName));

            var slides = deck.Slides.Select(s => new SlideState(s, SlideAssessor.Assess(s))).ToList();
            var state = new DeckState(id, Path.GetFileName(fileName), deck.Title, _time.GetUtcNow(), slides);
            var entry = new Entry(state);
            Persist(state);
            _decks[id] = entry;
            return state;
        }
        catch
        {
            TryDeleteDirectory(directory);
            throw;
        }
    }

    public DeckState? Get(string id) => _decks.TryGetValue(id, out var entry) ? entry.State : null;

    public IReadOnlyList<DeckSummary> List() =>
        _decks.Values.Select(e => DeckSummary.From(e.State)).OrderByDescending(d => d.UploadedAt).ToList();

    public Stream OpenOriginal(string id) => File.OpenRead(Path.Combine(Root, id, OriginalFileName));

    public bool Delete(string id)
    {
        if (!_decks.TryGetValue(id, out var entry)) return false;
        lock (entry.Sync)
        {
            if (!_decks.TryRemove(id, out _)) return false;
            TryDeleteDirectory(Path.Combine(Root, id));
            return true;
        }
    }

    /// <summary>Atomically updates one slide. Returns the updated slide, or null if the deck/slide does not exist.</summary>
    public SlideState? UpdateSlide(string deckId, int slideNumber, Func<SlideState, SlideState> update, bool persist = true)
        => UpdateSlides(deckId, [slideNumber], update, persist)?.SingleOrDefault();

    /// <summary>Claims/updates a batch under one lock and persists one snapshot, rather than rewriting the deck per slide.</summary>
    public IReadOnlyList<SlideState>? UpdateSlides(
        string deckId, IEnumerable<int> slideNumbers, Func<SlideState, SlideState> update, bool persist = true)
    {
        if (!_decks.TryGetValue(deckId, out var entry)) return null;
        lock (entry.Sync)
        {
            if (!_decks.ContainsKey(deckId)) return null;
            var slides = entry.State.Slides.ToArray();
            var result = new List<SlideState>();
            var changed = false;
            foreach (var number in slideNumbers.Distinct())
            {
                var index = number - 1;
                if (index < 0 || index >= slides.Length) continue;
                var updated = update(slides[index]);
                changed |= !ReferenceEquals(updated, slides[index]);
                slides[index] = updated;
                result.Add(updated);
            }
            if (changed)
            {
                var state = entry.State with { Slides = slides };
                if (persist) Persist(state);
                entry.State = state;
            }
            return result;
        }
    }

    public SlideState? AppendActivity(string deckId, int slideNumber, string message) =>
        UpdateSlide(deckId, slideNumber, s => s with
        {
            Activity = s.Activity.Append(message).TakeLast(MaxActivityEntries).ToList(),
        }, persist: false);

    private void Persist(DeckState state)
    {
        var path = Path.Combine(Root, state.Id, StateFileName);
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(state, JsonOptions));
        File.Move(temp, path, overwrite: true);
    }

    private void LoadExisting()
    {
        foreach (var directory in Directory.EnumerateDirectories(Root))
        {
            var statePath = Path.Combine(directory, StateFileName);
            if (!File.Exists(statePath) || !File.Exists(Path.Combine(directory, OriginalFileName))) continue;
            try
            {
                var state = JsonSerializer.Deserialize<DeckState>(File.ReadAllText(statePath), JsonOptions);
                if (state is null) continue;
                // Work that was in flight when the app stopped can't resume; surface it as cancelled.
                var slides = state.Slides.Select(s => s.Status is EnrichmentStatus.Queued or EnrichmentStatus.Running
                    ? s with { Status = EnrichmentStatus.Cancelled, Error = "Interrupted by an application restart.", JobId = null, CancellationRequested = false }
                    : s).ToList();
                _decks[state.Id] = new Entry(state with { Slides = slides });
            }
            catch (Exception ex) when (ex is JsonException or IOException)
            {
                _logger.LogWarning(ex, "Skipping unreadable deck state in {Directory}", directory);
            }
        }
    }

    private void TryDeleteDirectory(string directory)
    {
        try
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
        catch (IOException ex)
        {
            _logger.LogWarning(ex, "Could not delete {Directory}", directory);
        }
    }

    private sealed class Entry(DeckState state)
    {
        public object Sync { get; } = new();
        public DeckState State { get; set; } = state;
    }
}
