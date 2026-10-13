using System.ComponentModel;

namespace PptxEnricher.Api.Enrichment;

[Description("Speaker notes for one slide plus the evidence the presenter needs to review them.")]
public sealed record EnrichmentResponse(
    [property: Description("Only the speaker text, in exactly this layout: the line 'English Version', the English text, one blank line, the line 'Dutch Version', the Dutch text. Plain text without Markdown, bullets, citations, URLs, source names or a sources section.")]
    string SpeakerNotes,
    [property: Description("Up to 6 facts the notes rely on, in English. End each fact with the number of its supporting source in the sources list, e.g. '[1]', or with '[slide]' when only the slide text or existing notes support it.")]
    List<string> KeyFacts,
    [property: Description("Web pages that were fetched and actually used, most important first. Empty if none.")]
    List<EnrichmentSource> Sources,
    [property: Description("In English: outdated or contradicted slide claims, release-status changes, conflicting sources, unverifiable claims and points left out for lack of support. Empty if none.")]
    List<string> Warnings,
    [property: Description("'high' when an official source supports every fact in the notes, 'medium' when some facts rest only on the slide or non-official sources, 'low' when no source could be fetched.")]
    string Confidence);

public sealed record EnrichmentSource(
    [property: Description("Page title.")] string Title,
    [property: Description("Absolute http(s) URL of the page.")] string Url);
