using System.Threading.Channels;
using Microsoft.Extensions.Options;
using PptxEnricher.Api.Storage;

namespace PptxEnricher.Api.Enrichment;

public sealed record EnrichmentJobInfo(string JobId, string DeckId, IReadOnlyList<int> Slides);
public sealed record ResearchQueueItem(int SlideNumber, string JobId, EnrichmentStatus Status, bool CancellationRequested);
public sealed record ResearchQueueState(int MaxConcurrency, IReadOnlyList<ResearchQueueItem> Items);

/// <summary>One FIFO queue and bounded worker pool shared by every deck and batch.</summary>
public sealed class EnrichmentJobQueue(
    DeckStore store,
    DeckEventHub events,
    ISlideEnricher enricher,
    IOptions<CopilotOptions> options,
    ILogger<EnrichmentJobQueue> logger) : BackgroundService
{
    private readonly Channel<WorkItem> _queue = Channel.CreateUnbounded<WorkItem>();
    private readonly object _sync = new();
    private readonly Dictionary<string, JobRuntime> _jobs = new();
    private readonly Dictionary<(string DeckId, int Number), WorkItem> _items = new();
    private long _sequence;
    private bool _accepting = true;

    public int MaxConcurrency { get; } = Math.Clamp(options.Value.MaxConcurrency, 1, 8);

    public ResearchQueueState GetQueue(string deckId)
    {
        lock (_sync)
        {
            var slides = store.Get(deckId)?.Slides ?? [];
            var items = _items.Values.Where(i => i.Job.DeckId == deckId).OrderBy(i => i.Sequence)
                .Select(i => slides.FirstOrDefault(s => s.Content.Number == i.SlideNumber && s.JobId == i.Job.Id))
                .Where(s => s is { Status: EnrichmentStatus.Queued or EnrichmentStatus.Running })
                .Select(s => new ResearchQueueItem(s!.Content.Number, s.JobId!, s.Status, s.CancellationRequested))
                .ToList();
            return new ResearchQueueState(MaxConcurrency, items);
        }
    }

    public EnrichmentJobInfo Enqueue(string deckId, IEnumerable<int> slideNumbers, string? model)
    {
        lock (_sync)
        {
            if (!_accepting) throw new InvalidOperationException("The research queue is shutting down.");
            var job = new JobRuntime(Guid.NewGuid().ToString("N"), deckId, model);
            var slides = store.UpdateSlides(deckId, slideNumbers.Distinct().Order(), s =>
                s.Status is EnrichmentStatus.Queued or EnrichmentStatus.Running ? s : s with
                {
                    Status = EnrichmentStatus.Queued, JobId = job.Id, CancellationRequested = false,
                    Error = null, Activity = [],
                }) ?? [];
            var claimed = slides.Where(s => s.JobId == job.Id).ToList();
            if (claimed.Count == 0) return new EnrichmentJobInfo(job.Id, deckId, []);

            job.Remaining = claimed.Count;
            _jobs.Add(job.Id, job);
            foreach (var slide in claimed)
            {
                var item = new WorkItem(job, slide.Content.Number, ++_sequence);
                _items.Add((deckId, item.SlideNumber), item);
                if (!_queue.Writer.TryWrite(item)) throw new InvalidOperationException("The research queue is closed.");
                PublishSlide(deckId, slide, job.Id);
            }
            PublishQueue(deckId);
            events.Publish(new DeckEvent(DeckEventTypes.Job, deckId, JobId: job.Id, Status: "queued",
                Message: $"{claimed.Count} slide(s) queued"));
            logger.LogInformation("Queued job {JobId} for deck {DeckId}: {Count} slide(s)", job.Id, deckId, claimed.Count);
            return new EnrichmentJobInfo(job.Id, deckId, claimed.Select(s => s.Content.Number).ToList());
        }
    }

    public SlideState? CancelSlide(string deckId, int number, string jobId)
    {
        lock (_sync)
            return _items.TryGetValue((deckId, number), out var item) && item.Job.Id == jobId
                ? CancelItem(item) : null;
    }

    public bool Cancel(string jobId)
    {
        lock (_sync)
        {
            if (!_jobs.ContainsKey(jobId)) return false;
            foreach (var item in _items.Values.Where(i => i.Job.Id == jobId).ToArray()) CancelItem(item);
            return true;
        }
    }

    public void CancelDeck(string deckId)
    {
        lock (_sync)
            foreach (var item in _items.Values.Where(i => i.Job.DeckId == deckId).ToArray()) CancelItem(item);
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        lock (_sync)
        {
            _accepting = false;
            _queue.Writer.TryComplete();
            foreach (var item in _items.Values.ToArray()) CancelItem(item);
        }
        await base.StopAsync(cancellationToken);
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.WhenAll(Enumerable.Range(0, MaxConcurrency).Select(_ => RunWorkerAsync(stoppingToken)));

    private async Task RunWorkerAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var item in _queue.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await ProcessAsync(item, stoppingToken);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Enrichment failed for slide {Slide} of deck {DeckId}", item.SlideNumber, item.Job.DeckId);
                    Finish(item, null, ex, stoppingToken.IsCancellationRequested);
                }
                finally
                {
                    await CompleteItemAsync(item);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    private async Task ProcessAsync(WorkItem item, CancellationToken stoppingToken)
    {
        DeckState? deck;
        lock (_sync)
        {
            // Removed channel entries are tombstones. Identity also protects an immediate requeue.
            if (!IsCurrent(item)) return;
            if (stoppingToken.IsCancellationRequested) { CancelItem(item); return; }
            var running = store.UpdateSlide(item.Job.DeckId, item.SlideNumber, s =>
                s.JobId == item.Job.Id && s.Status == EnrichmentStatus.Queued
                    ? s with { Status = EnrichmentStatus.Running } : s);
            if (running is not { Status: EnrichmentStatus.Running } || running.JobId != item.Job.Id) return;
            item.Started = true;
            PublishSlide(item.Job.DeckId, running, item.Job.Id);
            PublishQueue(item.Job.DeckId);
            deck = store.Get(item.Job.DeckId);
        }
        if (deck is null) return;

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, item.Cts.Token);
        try
        {
            linked.Token.ThrowIfCancellationRequested();
            var proposal = await enricher.EnrichAsync(deck, item.SlideNumber, item.Job.Model,
                message => AddActivity(item, message), linked.Token);
            Finish(item, proposal, null, linked.IsCancellationRequested);
        }
        catch (OperationCanceledException) when (linked.IsCancellationRequested)
        {
            Finish(item, null, null, true);
        }
    }

    private SlideState? CancelItem(WorkItem item)
    {
        item.Job.HadCancellation = true;
        var slide = store.UpdateSlide(item.Job.DeckId, item.SlideNumber, s => s.JobId != item.Job.Id ? s :
            item.Started ? s with { CancellationRequested = true } : s with
            {
                Status = EnrichmentStatus.Cancelled, JobId = null, CancellationRequested = false, Error = null,
                Activity = s.Activity.Append(Stamp("Removed from queue")).TakeLast(DeckStore.MaxActivityEntries).ToList(),
            });
        if (item.Started)
        {
            // CancelAsync signals immediately but runs external callbacks outside the queue lock.
            item.CancellationRequested = true;
            item.CancelCallbacks ??= item.Cts.CancelAsync();
        }
        else
        {
            CompleteItem(item);
            item.Cts.Dispose();
            item.Disposed = true;
        }
        if (slide is not null) PublishSlide(item.Job.DeckId, slide, item.Job.Id);
        PublishQueue(item.Job.DeckId);
        return slide;
    }

    private void Finish(WorkItem item, EnrichmentProposal? proposal, Exception? error, bool stopping)
    {
        lock (_sync)
        {
            if (!IsCurrent(item)) return;
            var cancelled = item.CancellationRequested || stopping;
            item.Job.HadCancellation |= cancelled;
            var message = cancelled ? "Cancelled" : error is not null ? $"Failed: {error.Message}"
                : $"Proposal ready ({proposal!.Sources.Count} source(s))";
            var slide = store.UpdateSlide(item.Job.DeckId, item.SlideNumber, s =>
            {
                if (s.JobId != item.Job.Id) return s;
                var updated = cancelled ? s with { Status = EnrichmentStatus.Cancelled, Error = null }
                    : error is not null ? s with { Status = EnrichmentStatus.Failed, Error = error.Message }
                    : s with { Status = EnrichmentStatus.Succeeded, Proposal = proposal, Review = ReviewStatus.Pending, AcceptedNotes = null, Error = null };
                return updated with
                {
                    JobId = null, CancellationRequested = false,
                    Activity = s.Activity.Append(Stamp(message)).TakeLast(DeckStore.MaxActivityEntries).ToList(),
                };
            });
            if (slide is not null) PublishSlide(item.Job.DeckId, slide, item.Job.Id);
            CompleteItem(item);
            PublishQueue(item.Job.DeckId);
        }
    }

    private void AddActivity(WorkItem item, string message)
    {
        lock (_sync)
        {
            if (!IsCurrent(item) || item.CancellationRequested) return;
            var stamped = Stamp(message);
            var changed = false;
            store.UpdateSlide(item.Job.DeckId, item.SlideNumber, s =>
            {
                if (s.JobId != item.Job.Id || s.Status != EnrichmentStatus.Running) return s;
                changed = true;
                return s with { Activity = s.Activity.Append(stamped).TakeLast(DeckStore.MaxActivityEntries).ToList() };
            }, persist: false);
            if (changed)
                events.Publish(new DeckEvent(DeckEventTypes.Activity, item.Job.DeckId, item.SlideNumber, item.Job.Id, Message: stamped));
        }
    }

    private async Task CompleteItemAsync(WorkItem item)
    {
        lock (_sync)
        {
            if (item.Disposed) return;
            if (IsCurrent(item))
            {
                CompleteItem(item);
                PublishQueue(item.Job.DeckId);
            }
            item.Disposed = true;
        }
        try { if (item.CancelCallbacks is { } callbacks) await callbacks; }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Cancellation callback failed for slide {Slide} of deck {DeckId}", item.SlideNumber, item.Job.DeckId);
        }
        finally { item.Cts.Dispose(); }
    }

    private void CompleteItem(WorkItem item)
    {
        _items.Remove((item.Job.DeckId, item.SlideNumber));
        if (--item.Job.Remaining != 0) return;
        _jobs.Remove(item.Job.Id);
        events.Publish(new DeckEvent(DeckEventTypes.Job, item.Job.DeckId, JobId: item.Job.Id,
            Status: item.Job.HadCancellation ? "cancelled" : "completed"));
    }

    private bool IsCurrent(WorkItem item) =>
        _items.TryGetValue((item.Job.DeckId, item.SlideNumber), out var current) && ReferenceEquals(current, item);

    private void PublishQueue(string deckId) => events.Publish(new DeckEvent(DeckEventTypes.Queue, deckId));
    private void PublishSlide(string deckId, SlideState slide, string jobId) =>
        events.Publish(new DeckEvent(DeckEventTypes.SlideStatus, deckId, slide.Content.Number, jobId, slide.Status.ToString(), Slide: slide));
    private static string Stamp(string message) => $"{DateTimeOffset.Now:HH:mm:ss} {message}";

    private sealed class WorkItem(JobRuntime job, int slideNumber, long sequence)
    {
        public JobRuntime Job { get; } = job;
        public int SlideNumber { get; } = slideNumber;
        public long Sequence { get; } = sequence;
        public CancellationTokenSource Cts { get; } = new();
        public bool Started { get; set; }
        public bool CancellationRequested { get; set; }
        public bool Disposed { get; set; }
        public Task? CancelCallbacks { get; set; }
    }

    private sealed class JobRuntime(string id, string deckId, string? model)
    {
        public string Id { get; } = id;
        public string DeckId { get; } = deckId;
        public string? Model { get; } = model;
        public int Remaining { get; set; }
        public bool HadCancellation { get; set; }
    }
}
