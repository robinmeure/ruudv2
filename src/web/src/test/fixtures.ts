import type { DeckState, EnrichmentProposal, SlideState } from '../api/types'

export function makeProposal(): EnrichmentProposal {
  return {
    notes: 'English Version\nExplain the migration plan and confirm the prerequisites.\n\nDutch Version\nLeg het migratieplan uit en bevestig de vereisten.',
    keyFacts: ['Review the prerequisites with the presenter. [1]'],
    sources: [{ title: 'Azure migration overview', url: 'https://learn.microsoft.com/en-us/azure/migrate/migrate-services-overview' }],
    warnings: ['Confirm release status before presenting.'],
    confidence: 'medium',
    language: 'en+nl',
    model: 'fixture-model',
    createdAt: '2026-10-01T10:00:00Z',
  }
}

export function makeSlide(number: number, overrides: Partial<SlideState> = {}): SlideState {
  return {
    content: {
      number, title: `Slide topic ${number}`, section: 'Delivery',
      layoutName: 'Title and Content', hidden: false,
      paragraphs: [{ text: 'Explain the context, the prerequisites, and the next step.', level: 0 }],
      tables: [], pictureCount: 0, pictureDescriptions: [], chartCount: 0, chartTitles: [],
      links: [], hasNotesPart: true, notes: 'Original presenter notes.',
    },
    assessment: {
      kind: 'Content', notesStatus: 'Thin', slideWordCount: 20, notesWordCount: 4,
      coverage: 0.5, notesHaveSources: false, timeSensitive: false,
      priority: 1, flagged: true, suggestSkip: false, reasons: ['Notes are thin.'],
    },
    status: 'Idle', error: null, jobId: null, cancellationRequested: false, proposal: null, review: 'None', acceptedNotes: null, activity: [],
    ...overrides,
  }
}

export function makeDeck(count = 78): DeckState {
  const slides = Array.from({ length: count }, (_, i) => makeSlide(i + 1))
  if (slides[0]) {
    slides[0].content.title = 'Opening'
    slides[0].content.section = 'Introduction'
    slides[0].assessment = { ...slides[0].assessment, kind: 'Title', suggestSkip: true, flagged: false }
  }
  if (slides[1]) {
    slides[1].content.title = 'Why migrate now'
    slides[1].content.section = 'Business case'
    slides[1].proposal = makeProposal()
    slides[1].status = 'Succeeded'
    slides[1].review = 'Pending'
  }
  if (slides[2]) {
    slides[2].content.title = null
    slides[2].content.paragraphs = []
    slides[2].content.pictureCount = 1
    slides[2].content.notes = ''
    slides[2].content.hasNotesPart = false
    slides[2].assessment.notesStatus = 'Missing'
  }
  if (slides[3]) {
    slides[3].content.title = 'Samenwerken aan een zorgvuldig onderbouwd migratieplan voor internationale organisaties en hun bestaande infrastructuur'
    slides[3].content.hidden = true
    slides[3].content.notes = ('Bespreek de uitgangspunten en controleer samen met het team de belangrijkste afhankelijkheden.\n').repeat(16)
    slides[3].assessment.suggestSkip = true
  }
  if (slides[4]) {
    slides[4].status = 'Running'
    slides[4].jobId = 'job-5'
    slides[4].activity = ['10:01:00 Reading public documentation.']
  }
  if (slides[5]) {
    slides[5].status = 'Failed'
    slides[5].error = 'The public source did not respond.'
  }
  if (slides[6]) {
    slides[6].proposal = makeProposal()
    slides[6].review = 'Accepted'
    slides[6].acceptedNotes = 'Accepted presenter notes.'
  }
  if (slides[7]) slides[7].status = 'Cancelled'
  if (slides[8]) { slides[8].proposal = makeProposal(); slides[8].review = 'Rejected' }
  if (slides[9]) {
    slides[9].assessment = { ...slides[9].assessment, flagged: false, notesStatus: 'Ok', reasons: [] }
  }
  return { id: 'fixture-deck', fileName: 'storyboard-fixture.pptx', title: 'Migration planning workshop', uploadedAt: '2026-10-01T09:00:00Z', slides }
}
