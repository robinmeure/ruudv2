using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using PptxEnricher.Api.Enrichment;
using PptxEnricher.Api.Storage;

namespace PptxEnricher.Api.Tests;

public class EnrichmentJobQueueTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task Workers_overlap_respect_global_limit_and_refill_without_waiting_for_batch(int limit)
    {
        await using var h = new QueueHarness(limit);
        var first = await h.Deck(limit + 2);
        var second = await h.Deck(2);
        h.Queue.Enqueue(first.Id, Enumerable.Range(1, limit + 2), null);
        h.Queue.Enqueue(second.Id, [1, 2], null);
        await h.Queue.StartAsync(default);

        var calls = await h.Fake.Next(limit);
        Assert.Equal(limit, h.Fake.Active);
        Assert.Equal(limit, h.Fake.Calls.Count);
        Assert.Equal(2, h.Queue.GetQueue(first.Id).Items.Count(i => i.Status == EnrichmentStatus.Queued));
        Assert.All(h.Queue.GetQueue(second.Id).Items, i => Assert.Equal(EnrichmentStatus.Queued, i.Status));

        calls[0].Complete();
        var refill = await h.Fake.Next();
        Assert.Equal((first.Id, limit + 1), (refill.DeckId, refill.Number));
        Assert.Equal(limit, h.Fake.Active);
        refill.Complete();
        var last = await h.Fake.Next();
        Assert.Equal((first.Id, limit + 2), (last.DeckId, last.Number));
        last.Complete();
        var nextDeck = await h.Fake.Next();
        Assert.Equal((second.Id, 1), (nextDeck.DeckId, nextDeck.Number));
        Assert.Equal(limit, h.Fake.Maximum);
    }

    [Fact]
    public async Task Removing_waiting_slide_never_executes_it_and_requeue_keeps_FIFO_and_prior_notes()
    {
        await using var h = new QueueHarness(1);
        var deck = await h.Deck(3);
        var original = h.Accept(deck.Id, 2);
        var job = h.Queue.Enqueue(deck.Id, [1, 2, 3], null);
        await h.Queue.StartAsync(default);
        var first = await h.Fake.Next();

        var removed = h.Queue.CancelSlide(deck.Id, 2, job.JobId)!;
        Assert.Equal(EnrichmentStatus.Cancelled, removed.Status);
        Assert.Null(removed.JobId);
        Assert.Equal(original.Proposal, removed.Proposal);
        Assert.Equal(original.AcceptedNotes, removed.AcceptedNotes);
        Assert.Equal(ReviewStatus.Accepted, removed.Review);
        var retry = h.Queue.Enqueue(deck.Id, [2], null);
        Assert.NotEqual(job.JobId, retry.JobId);
        Assert.Null(h.Queue.CancelSlide(deck.Id, 2, job.JobId));
        Assert.Equal([1, 3, 2], h.Queue.GetQueue(deck.Id).Items.Select(i => i.SlideNumber));
        first.Complete();
        var next = await h.Fake.Next();
        Assert.Equal(3, next.Number);
        next.Complete();
        var requeued = await h.Fake.Next();
        Assert.Equal(2, requeued.Number);
        requeued.Result.SetException(new InvalidOperationException("Test research failure"));
        await h.WaitStatus(deck.Id, 2, EnrichmentStatus.Failed);
        Assert.Equal(3, h.Fake.Calls.Count);
        Assert.Equal(original.AcceptedNotes, h.Slide(deck.Id, 2).AcceptedNotes);
        Assert.Equal(original.Proposal, h.Slide(deck.Id, 2).Proposal);
        Assert.Empty(h.Queue.GetQueue(deck.Id).Items);
        Assert.False(h.Queue.Cancel(job.JobId));
    }

    [Fact]
    public async Task Stopping_one_slide_keeps_siblings_and_slot_until_session_exits_and_rejects_late_success()
    {
        await using var h = new QueueHarness(2);
        h.Fake.IgnoreCancellation = true;
        var deck = await h.Deck(3);
        var original = h.Accept(deck.Id, 1);
        var job = h.Queue.Enqueue(deck.Id, [1, 2, 3], null);
        await h.Queue.StartAsync(default);
        var calls = await h.Fake.Next(2);
        var first = calls.Single(c => c.Number == 1);
        var sibling = calls.Single(c => c.Number == 2);

        var stopping = h.Queue.CancelSlide(deck.Id, 1, job.JobId)!;
        Assert.True(stopping.CancellationRequested);
        Assert.Equal(EnrichmentStatus.Running, stopping.Status);
        Assert.True(h.Queue.CancelSlide(deck.Id, 1, job.JobId)!.CancellationRequested);
        await first.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(sibling.Token.IsCancellationRequested);
        Assert.Equal(2, h.Fake.Calls.Count);
        Assert.Equal(EnrichmentStatus.Queued, h.Slide(deck.Id, 3).Status);

        first.Complete();
        var third = await h.Fake.Next();
        Assert.Equal(3, third.Number);
        await h.WaitStatus(deck.Id, 1, EnrichmentStatus.Cancelled);
        Assert.Equal(original.Proposal, h.Slide(deck.Id, 1).Proposal);
        Assert.Equal(original.AcceptedNotes, h.Slide(deck.Id, 1).AcceptedNotes);
        Assert.False(h.Slide(deck.Id, 1).CancellationRequested);

        var retry = h.Queue.Enqueue(deck.Id, [1], null);
        Assert.Null(h.Queue.CancelSlide(deck.Id, 1, job.JobId));
        first.Activity("Late callback from the old session");
        Assert.Empty(h.Slide(deck.Id, 1).Activity);
        sibling.Complete();
        var newRun = await h.Fake.Next();
        Assert.Equal(1, newRun.Number);
        Assert.Equal(retry.JobId, h.Slide(deck.Id, 1).JobId);
        Assert.False(newRun.Token.IsCancellationRequested);
    }

    [Fact]
    public async Task Throwing_cancellation_callbacks_do_not_remove_a_worker_from_the_pool()
    {
        await using var h = new QueueHarness(1);
        h.Fake.IgnoreCancellation = true;
        h.Fake.ThrowOnCancellation = true;
        var deck = await h.Deck(2);
        var job = h.Queue.Enqueue(deck.Id, [1, 2], null);
        await h.Queue.StartAsync(default);
        var first = await h.Fake.Next();
        Assert.True(h.Queue.CancelSlide(deck.Id, 1, job.JobId)!.CancellationRequested);
        await first.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        first.Complete();
        var second = await h.Fake.Next();
        Assert.Equal(2, second.Number);
        Assert.Equal(EnrichmentStatus.Cancelled, h.Slide(deck.Id, 1).Status);
        second.Complete();
        await h.WaitStatus(deck.Id, 2, EnrichmentStatus.Succeeded);
    }

    [Fact]
    public async Task Job_and_deck_cancellation_remain_scoped_and_completed_jobs_are_cleaned_up()
    {
        await using var h = new QueueHarness(2);
        var first = await h.Deck(4);
        var second = await h.Deck(1);
        var batch = h.Queue.Enqueue(first.Id, [1, 2, 3], null);
        h.Queue.Enqueue(first.Id, [4], null);
        h.Queue.Enqueue(second.Id, [1], null);
        await h.Queue.StartAsync(default);
        var initial = await h.Fake.Next(2);
        Assert.True(h.Queue.Cancel(batch.JobId));
        foreach (var call in initial) await call.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var next = await h.Fake.Next(2);
        var otherDeck = next.Single(c => c.DeckId == second.Id);
        var otherJob = next.Single(c => c.DeckId == first.Id);
        Assert.Equal(4, otherJob.Number);
        Assert.Equal(EnrichmentStatus.Cancelled, h.Slide(first.Id, 3).Status);
        Assert.DoesNotContain(h.Fake.Calls, c => c.DeckId == first.Id && c.Number == 3);
        h.Queue.CancelDeck(first.Id);
        await otherJob.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(otherDeck.Token.IsCancellationRequested);
        otherDeck.Complete();
        await h.WaitStatus(second.Id, 1, EnrichmentStatus.Succeeded);
        Assert.Null(h.Queue.CancelSlide(second.Id, 1, "old-job"));
        Assert.False(h.Queue.Cancel(batch.JobId));
    }

    [Fact]
    public async Task Shutdown_cancels_and_persists_running_and_waiting_slides()
    {
        await using var h = new QueueHarness(1);
        var deck = await h.Deck(3);
        h.Accept(deck.Id, 1);
        h.Queue.Enqueue(deck.Id, [1, 2, 3], null);
        await h.Queue.StartAsync(default);
        await h.Fake.Next();
        await h.Queue.StopAsync(default);
        var persisted = h.Reload().Get(deck.Id)!;
        Assert.All(persisted.Slides, s =>
        {
            Assert.Equal(EnrichmentStatus.Cancelled, s.Status);
            Assert.Null(s.JobId);
            Assert.False(s.CancellationRequested);
        });
        Assert.Equal("Previously accepted notes", persisted.Slides[0].AcceptedNotes);
        Assert.Empty(h.Queue.GetQueue(deck.Id).Items);
        Assert.Throws<InvalidOperationException>(() => h.Queue.Enqueue(deck.Id, [1], null));
    }

    [Fact]
    public async Task Concurrent_enqueues_claim_each_slide_once_and_restart_clears_stopping_state()
    {
        await using var h = new QueueHarness(4);
        var deck = await h.Deck(3);
        var queue = h.Queue;
        var jobs = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            Task.Run(() => queue.Enqueue(deck.Id, [3, 1, 2, 2], null))));
        Assert.Equal(3, jobs.Sum(j => j.Slides.Count));
        Assert.Equal([1, 2, 3], queue.GetQueue(deck.Id).Items.Select(i => i.SlideNumber));
        h.Store.UpdateSlide(deck.Id, 1, s => s with { Status = EnrichmentStatus.Running, CancellationRequested = true });
        Assert.All(h.Reload().Get(deck.Id)!.Slides, s =>
        {
            Assert.Equal(EnrichmentStatus.Cancelled, s.Status);
            Assert.False(s.CancellationRequested);
            Assert.Contains("restart", s.Error);
        });
    }

    [Fact]
    public async Task Queue_API_reports_four_workers_and_targeted_cancellation_requires_current_job()
    {
        using var fake = new ControlledEnricher();
        using var factory = new ApiFactory();
        using var server = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<ISlideEnricher>();
            services.AddSingleton<ISlideEnricher>(fake);
        }));
        using var client = server.CreateClient();
        var store = server.Services.GetRequiredService<DeckStore>();
        using var pptx = TestDeck.Build(Enumerable.Range(1, 6).Select(n => new TestSlide { Title = $"Slide {n}" }).ToArray());
        var deck = await store.CreateAsync("queue.pptx", pptx, default);
        var enqueue = await client.PostAsJsonAsync($"/api/decks/{deck.Id}/enrich", new { slides = Enumerable.Range(1, 6), model = (string?)null });
        enqueue.EnsureSuccessStatusCode();
        var job = (await enqueue.Content.ReadFromJsonAsync<EnrichmentJobInfo>())!;
        var running = await fake.Next(4);
        var queue = (await client.GetFromJsonAsync<ResearchQueueState>($"/api/decks/{deck.Id}/queue"))!;
        Assert.Equal(4, queue.MaxConcurrency);
        Assert.Equal(4, queue.Items.Count(i => i.Status == EnrichmentStatus.Running));
        Assert.Equal([5, 6], queue.Items.Where(i => i.Status == EnrichmentStatus.Queued).Select(i => i.SlideNumber));

        var url = $"/api/decks/{deck.Id}/slides/5/cancel";
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(url, new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(url, new { jobId = "stale" })).StatusCode);
        var removed = await client.PostAsJsonAsync(url, new { job.JobId });
        removed.EnsureSuccessStatusCode();
        Assert.Equal(EnrichmentStatus.Cancelled, (await removed.Content.ReadFromJsonAsync<SlideState>())!.Status);
        Assert.All(running, call => Assert.False(call.Token.IsCancellationRequested));
        var stop = await client.PostAsJsonAsync($"/api/decks/{deck.Id}/slides/1/cancel", new { job.JobId });
        stop.EnsureSuccessStatusCode();
        Assert.True((await stop.Content.ReadFromJsonAsync<SlideState>())!.CancellationRequested);
        var refill = await fake.Next();
        Assert.Equal(6, refill.Number);
        Assert.DoesNotContain(fake.Calls, c => c.Number == 5);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/decks/absent/queue")).StatusCode);

        var delete = await client.DeleteAsync($"/api/decks/{deck.Id}");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        await refill.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(Directory.Exists(Path.Combine(factory.StorageRoot, deck.Id)));
    }

    private sealed class QueueHarness(int limit) : IAsyncDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), "PptxEnricherTests", Guid.NewGuid().ToString("N"));
        public ControlledEnricher Fake { get; } = new();
        private DeckStore? _store;
        private EnrichmentJobQueue? _queue;
        public DeckStore Store => _store ??= Reload();
        public EnrichmentJobQueue Queue => _queue ??= new(Store, new DeckEventHub(), Fake,
            Options.Create(new CopilotOptions { MaxConcurrency = limit }), NullLogger<EnrichmentJobQueue>.Instance);
        public DeckStore Reload() => new(Options.Create(new StorageOptions { Root = _root }), TimeProvider.System, NullLogger<DeckStore>.Instance);
        public SlideState Slide(string id, int number) => Store.Get(id)!.Slides[number - 1];
        public async Task<DeckState> Deck(int count)
        {
            using var pptx = TestDeck.Build(Enumerable.Range(1, count).Select(n => new TestSlide
            {
                Title = $"Slide {n}", Notes = ["Original notes"],
            }).ToArray());
            return await Store.CreateAsync("test.pptx", pptx, default);
        }
        public SlideState Accept(string id, int number) => Store.UpdateSlide(id, number, s => s with
        {
            Review = ReviewStatus.Accepted, AcceptedNotes = "Previously accepted notes", Proposal = Proposal(),
        })!;
        public async Task WaitStatus(string id, int number, EnrichmentStatus status)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            while (Slide(id, number).Status != status) await Task.Delay(5, timeout.Token);
        }
        public async ValueTask DisposeAsync()
        {
            Fake.Shutdown();
            if (_queue is not null) { await _queue.StopAsync(default); _queue.Dispose(); }
            Fake.Dispose();
            if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        }
    }

    private static EnrichmentProposal Proposal() => new("Test proposal", [], [], [], "en+nl", "medium", "fake", DateTimeOffset.UtcNow);

    private sealed class ControlledCall(string deckId, int number, Action<string> activity, CancellationToken token)
    {
        public string DeckId { get; } = deckId;
        public int Number { get; } = number;
        public Action<string> Activity { get; } = activity;
        public CancellationToken Token { get; } = token;
        public TaskCompletionSource Cancelled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<EnrichmentProposal> Result { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Complete() => Result.TrySetResult(Proposal());
    }

    private sealed class ControlledEnricher : ISlideEnricher, IDisposable
    {
        private readonly Channel<ControlledCall> _starts = Channel.CreateUnbounded<ControlledCall>();
        private readonly CancellationTokenSource _shutdown = new();
        private readonly object _sync = new();
        public ConcurrentQueue<ControlledCall> Calls { get; } = new();
        public bool IgnoreCancellation { get; set; }
        public bool ThrowOnCancellation { get; set; }
        public int Active { get; private set; }
        public int Maximum { get; private set; }
        public async Task<EnrichmentProposal> EnrichAsync(DeckState deck, int slideNumber, string? model, Action<string> onActivity, CancellationToken cancellationToken)
        {
            var call = new ControlledCall(deck.Id, slideNumber, onActivity, cancellationToken);
            using var registration = cancellationToken.Register(() =>
            {
                call.Cancelled.TrySetResult();
                if (ThrowOnCancellation) throw new InvalidOperationException("Test cancellation callback failure");
            });
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token,
                IgnoreCancellation ? CancellationToken.None : cancellationToken);
            lock (_sync) { Active++; Maximum = Math.Max(Maximum, Active); }
            Calls.Enqueue(call);
            await _starts.Writer.WriteAsync(call);
            try { return await call.Result.Task.WaitAsync(linked.Token); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // WaitAsync can unwind and dispose the observer before its callback executes.
                call.Cancelled.TrySetResult();
                throw;
            }
            finally { lock (_sync) Active--; }
        }
        public async Task<ControlledCall> Next() => await _starts.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
        public async Task<ControlledCall[]> Next(int count)
        {
            var calls = new List<ControlledCall>();
            for (var i = 0; i < count; i++) calls.Add(await Next());
            return calls.ToArray();
        }
        public void Shutdown() => _shutdown.Cancel();
        public void Dispose() => _shutdown.Dispose();
    }
}
