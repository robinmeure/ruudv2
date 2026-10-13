using GitHub.Copilot;
using PptxEnricher.Api.Assessment;
using PptxEnricher.Api.Enrichment;
using PptxEnricher.Api.Pptx;
using PptxEnricher.Api.Storage;

namespace PptxEnricher.Api.Tests;

public class ToolPolicyTests
{
    [Theory]
    [InlineData("https://learn.microsoft.com/azure/", true)]
    [InlineData("http://example.com/page", true)]
    [InlineData("file:///C:/Windows/win.ini", false)]
    [InlineData("ftp://example.com/file", false)]
    [InlineData("http://localhost:5137/api/decks", false)]
    [InlineData("http://127.0.0.1/", false)]
    [InlineData("http://192.168.1.10/", false)]
    [InlineData("http://10.0.0.4/", false)]
    [InlineData("http://172.20.1.1/", false)]
    [InlineData("http://169.254.169.254/metadata/instance", false)]
    [InlineData("http://[::1]/", false)]
    [InlineData("http://intranet/", false)]
    [InlineData("http://printer.local/", false)]
    [InlineData("not a url", false)]
    public void Url_fetches_are_limited_to_public_http(string url, bool approved)
    {
        Assert.Equal(approved, ToolPolicy.Evaluate(new PermissionRequestUrl { Url = url, Intention = "test" }).Approved);
    }

    [Fact]
    public void Web_search_mcp_tool_is_allowed_but_other_mcp_tools_are_not()
    {
        Assert.True(ToolPolicy.Evaluate(Mcp("github-mcp-server", "web_search")).Approved);
        Assert.False(ToolPolicy.Evaluate(Mcp("github-mcp-server", "create_issue")).Approved);
        Assert.False(ToolPolicy.Evaluate(Mcp("other", "web_search")).Approved);
    }

    [Theory]
    [InlineData("release-communications", "get_recent_azure_updates", true)]
    [InlineData("release-communications", "get_azure_update_by_id", true)]
    [InlineData("release-communications", "release-communications-get_recent_azure_updates", true)]
    [InlineData("release-communications", "release-communications/get_azure_update_by_id", true)]
    [InlineData("release-communications", "get_recent_m365_roadmaps", false)]
    [InlineData("release-communications", "release-communications-get_recent_m365_roadmaps", false)]
    [InlineData("other", "get_recent_azure_updates", false)]
    public void Only_the_azure_updates_tools_of_the_release_communications_server_are_allowed(string server, string tool, bool approved)
    {
        Assert.Equal(approved, ToolPolicy.Evaluate(Mcp(server, tool)).Approved);
    }

    [Fact]
    public void Available_tools_include_the_azure_updates_tools_only_when_enabled()
    {
        Assert.Equal(["web_search", "web_fetch"], ToolPolicy.AvailableTools(false));

        var enabled = ToolPolicy.AvailableTools(true);
        Assert.Contains("release-communications-get_recent_azure_updates", enabled);
        Assert.Contains("release-communications/get_azure_update_by_id", enabled);
        Assert.DoesNotContain(enabled, t => t.Contains("m365", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(typeof(PermissionRequestShell))]
    [InlineData(typeof(PermissionRequestWrite))]
    [InlineData(typeof(PermissionRequestRead))]
    public void Shell_write_and_read_requests_are_rejected(Type requestType)
    {
        var request = (PermissionRequest)System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(requestType);

        Assert.False(ToolPolicy.Evaluate(request).Approved);
    }

    private static PermissionRequestMcp Mcp(string server, string tool) =>
        new() { ServerName = server, ToolName = tool, ToolTitle = tool, ReadOnly = true };
}

public class ProposalNormalizerTests
{
    [Fact]
    public void Strips_markdown_and_normalises_bullets()
    {
        var notes = ProposalNormalizer.NormalizeNotes("## Heading\r\n**Bold** point\n- first\n  * second\n\n\n\nSources:");

        Assert.Equal("Heading\nBold point\n• first\n  • second\n\nSources:", notes);
    }

    [Fact]
    public void Builds_proposal_with_clean_sources_renumbered_facts_and_defaults()
    {
        var response = new EnrichmentResponse(
            "English Version\nYou can now do this.\n\nDutch Version\nJe kunt dit nu doen.",
            ["Fact A [1]", "Fact B [2]", "Fact C [3].", "Fact D [4][2]", "Fact E [1][2]", "Slide fact [slide]", " ", "Fact A [1]"],
            [
                new EnrichmentSource("Docs", "https://learn.microsoft.com/a"),
                new EnrichmentSource("Dup", "https://learn.microsoft.com/a/"),
                new EnrichmentSource("Local", "http://localhost/secret"),
                new EnrichmentSource("", "https://azure.microsoft.com/updates"),
            ],
            [],
            "certain");

        var proposal = ProposalNormalizer.ToProposal(response, "gpt-x", DateTimeOffset.UnixEpoch, 125);

        Assert.Equal(["Fact A [1]", "Fact B [1]", "Fact C.", "Fact D [2][1]", "Fact E [1]", "Slide fact [slide]"], proposal.KeyFacts);
        Assert.Equal(
            [new SourceRef("Docs", "https://learn.microsoft.com/a"), new SourceRef("https://azure.microsoft.com/updates", "https://azure.microsoft.com/updates")],
            proposal.Sources);
        Assert.Equal("en+nl", proposal.Language);
        Assert.Empty(proposal.Warnings);
        Assert.Equal("medium", proposal.Confidence);
        Assert.Equal("gpt-x", proposal.Model);
    }

    [Fact]
    public void Remaining_rule_breaks_become_warnings()
    {
        var response = new EnrichmentResponse("Single-language notes with a link https://learn.microsoft.com/x", [], [], ["Slide date is outdated."], "high");

        var proposal = ProposalNormalizer.ToProposal(response, null, DateTimeOffset.UnixEpoch, 125);

        Assert.Equal("und", proposal.Language);
        Assert.Equal("Slide date is outdated.", proposal.Warnings[0]);
        Assert.Contains(proposal.Warnings, w => w.StartsWith("Format check: Use exactly two sections", StringComparison.Ordinal));
        Assert.Contains(proposal.Warnings, w => w.StartsWith("Format check: Remove the URLs", StringComparison.Ordinal));
    }

    [Fact]
    public void Empty_notes_are_rejected()
    {
        var response = new EnrichmentResponse("  ", [], [], [], "high");

        Assert.Throws<InvalidOperationException>(() => ProposalNormalizer.ToProposal(response, null, DateTimeOffset.UnixEpoch, 125));
    }

    [Fact]
    public void Repair_keeps_original_evidence_when_left_out()
    {
        var original = new EnrichmentResponse("old", ["Fact [1]"], [new EnrichmentSource("Docs", "https://learn.microsoft.com/a")], ["W1"], "high");
        var repaired = new EnrichmentResponse("new", [], [], ["W1", "W2"], "");

        var merged = SlideEnricher.KeepEvidence(original, repaired);

        Assert.Equal("new", merged.SpeakerNotes);
        Assert.Equal(original.KeyFacts, merged.KeyFacts);
        Assert.Equal(original.Sources, merged.Sources);
        Assert.Equal(["W1", "W2"], merged.Warnings);
        Assert.Equal("high", merged.Confidence);
    }
}

public class PromptBuilderTests
{
    private static DeckState Deck(params SlideContent[] slides) =>
        new("id", "deck.pptx", "Azure Briefing", DateTimeOffset.UnixEpoch,
            slides.Select(s => new SlideState(s, SlideAssessor.Assess(s))).ToList());

    [Fact]
    public void Includes_context_neighbours_date_existing_notes_and_linked_sources()
    {
        var deck = Deck(
            new SlideContent { Number = 1, Title = "Intro" },
            new SlideContent
            {
                Number = 2,
                Title = "Retirement: Basic public IPs",
                Section = "Retirements",
                Paragraphs = [new("Retire on 30 September 2025", 0), new("Upgrade to Standard", 1)],
                Tables = [new SlideTable([["SKU", "Date"], ["Basic", "2025-09-30"]])],
                Links = ["https://azure.microsoft.com/updates/basic-ip", "http://localhost/internal"],
                Notes = "Bestaande notities over de migratie naar Standard SKU, zie https://learn.microsoft.com/azure/ip-upgrade. En https://azure.microsoft.com/updates/basic-ip/",
            },
            new SlideContent { Number = 3, Title = "Next topic" });

        var prompt = PromptBuilder.Build(deck, deck.Slides[1], new DateOnly(2026, 10, 13), 250).Replace("\r\n", "\n");

        Assert.Contains("Deck: Azure Briefing", prompt);
        Assert.Contains("Slide 2 of 3", prompt);
        Assert.Contains("Section: Retirements", prompt);
        Assert.Contains("Previous slide: Intro", prompt);
        Assert.Contains("Next slide: Next topic", prompt);
        Assert.Contains("Today's date: 2026-10-13", prompt);
        Assert.Contains("  - Upgrade to Standard", prompt);
        Assert.Contains("| Basic | 2025-09-30 |", prompt);
        Assert.Contains("Bestaande notities", prompt);
        Assert.Contains("## Linked sources\n- https://azure.microsoft.com/updates/basic-ip\n- https://learn.microsoft.com/azure/ip-upgrade\n\n", prompt);
        Assert.Contains("at most 125 words per language", prompt);
        Assert.Contains("Confirm the current release status and dates as of 2026-10-13", prompt);
        Assert.DoesNotContain("rather than a product update", prompt);
    }

    [Fact]
    public void Asks_for_a_short_unresearched_note_on_non_update_slides()
    {
        var deck = Deck(new SlideContent { Number = 1, Title = "Overzicht", Paragraphs = [new("Nieuwe functies in Azure", 0)] });

        var prompt = PromptBuilder.Build(deck, deck.Slides[0], new DateOnly(2026, 1, 1), 200).Replace("\r\n", "\n");

        Assert.Contains("Existing speaker notes\n(none)", prompt);
        Assert.Contains("(none: search for the official announcement or documentation)", prompt);
        Assert.Contains("title slide rather than a product update", prompt);
        Assert.Contains("at most 100 words per language", prompt);
        Assert.DoesNotContain("Previous slide", prompt);
    }

    [Fact]
    public void System_message_combines_guardrails_and_instructions()
    {
        Assert.Contains("untrusted data", PromptBuilder.SystemMessage);
        Assert.Contains("## Final check", PromptBuilder.SystemMessage);
        Assert.DoesNotContain("\r", PromptBuilder.Instructions);
    }

    [Fact]
    public void Repair_prompt_lists_every_issue()
    {
        var check = new NotesCheck("x", "und", ["Rule A"], ["Advice B"]);

        var prompt = PromptBuilder.BuildRepair(check);

        Assert.Contains("- Rule A", prompt);
        Assert.Contains("- Advice B", prompt);
        Assert.Contains("do not research again", prompt);
    }
}

public class CopilotConnectionTests
{
    [Theory]
    [InlineData("localhost:4321", "localhost:4321")]
    [InlineData("tcp://localhost:5000", "localhost:5000")]
    [InlineData("http://127.0.0.1:7000/", "127.0.0.1:7000")]
    [InlineData("", "localhost:4321")]
    [InlineData(null, "localhost:4321")]
    public void Normalises_cli_url(string? input, string expected)
    {
        Assert.Equal(expected, CopilotConnection.NormalizeUrl(input));
    }
}
