using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace PptxEnricher.Api.Storage;

public sealed record DeckEvent(
    string Type,
    string DeckId,
    int? SlideNumber = null,
    string? JobId = null,
    string? Status = null,
    string? Message = null,
    SlideState? Slide = null)
{
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;
}

public static class DeckEventTypes
{
    public const string Connected = "connected";
    public const string Heartbeat = "heartbeat";
    public const string SlideStatus = "slide-status";
    public const string Activity = "activity";
    public const string Job = "job";
    public const string Queue = "queue";
}

/// <summary>Fan-out of deck events to SSE subscribers.</summary>
public sealed class DeckEventHub
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, Channel<DeckEvent>>> _subscribers = new();

    public void Publish(DeckEvent deckEvent)
    {
        if (!_subscribers.TryGetValue(deckEvent.DeckId, out var channels)) return;
        foreach (var channel in channels.Values)
            channel.Writer.TryWrite(deckEvent);
    }

    public async IAsyncEnumerable<DeckEvent> SubscribeAsync(
        string deckId,
        TimeSpan heartbeatInterval,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<DeckEvent>(new BoundedChannelOptions(500)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });
        var channels = _subscribers.GetOrAdd(deckId, _ => new());
        channels[id] = channel;
        try
        {
            yield return new DeckEvent(DeckEventTypes.Connected, deckId);
            while (!cancellationToken.IsCancellationRequested)
            {
                if (!await WaitForEventAsync(channel.Reader, heartbeatInterval, cancellationToken))
                {
                    yield return new DeckEvent(DeckEventTypes.Heartbeat, deckId);
                    continue;
                }
                while (channel.Reader.TryRead(out var item))
                    yield return item;
            }
        }
        finally
        {
            channels.TryRemove(id, out _);
        }
    }

    private static async Task<bool> WaitForEventAsync(ChannelReader<DeckEvent> reader, TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(timeout);
        try
        {
            return await reader.WaitToReadAsync(cts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return false;
        }
    }
}
