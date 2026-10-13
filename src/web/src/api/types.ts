export type SlideKind = 'Title' | 'Section' | 'Agenda' | 'Legal' | 'Closing' | 'Content'
export type NotesStatus = 'Missing' | 'PlaceholderOnly' | 'Thin' | 'Ok'
export type EnrichmentStatus = 'Idle' | 'Queued' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled'
export type ReviewStatus = 'None' | 'Pending' | 'Accepted' | 'Rejected'

export interface SlideParagraph {
  text: string
  level: number
}

export interface SlideTable {
  rows: string[][]
}

export interface SlideContent {
  number: number
  title: string | null
  section: string | null
  layoutName: string | null
  hidden: boolean
  paragraphs: SlideParagraph[]
  tables: SlideTable[]
  pictureCount: number
  pictureDescriptions: string[]
  chartCount: number
  chartTitles: string[]
  links: string[]
  hasNotesPart: boolean
  notes: string
}

export interface SlideAssessment {
  kind: SlideKind
  notesStatus: NotesStatus
  slideWordCount: number
  notesWordCount: number
  coverage: number
  notesHaveSources: boolean
  timeSensitive: boolean
  priority: number
  flagged: boolean
  suggestSkip: boolean
  reasons: string[]
}

export interface SourceRef {
  title: string
  url: string
}

export interface EnrichmentProposal {
  notes: string
  keyFacts: string[]
  sources: SourceRef[]
  warnings: string[]
  language: string
  confidence: string
  model: string | null
  createdAt: string
}

export interface SlideState {
  content: SlideContent
  assessment: SlideAssessment
  status: EnrichmentStatus
  error: string | null
  jobId: string | null
  cancellationRequested: boolean
  proposal: EnrichmentProposal | null
  review: ReviewStatus
  acceptedNotes: string | null
  activity: string[]
}

export interface DeckState {
  id: string
  fileName: string
  title: string
  uploadedAt: string
  slides: SlideState[]
}

export interface DeckSummary {
  id: string
  fileName: string
  title: string
  uploadedAt: string
  slideCount: number
  flaggedCount: number
  proposalCount: number
  acceptedCount: number
}

export interface CopilotModel {
  id: string
  name: string
  multiplier: number | null
}

export interface CopilotStatus {
  connected: boolean
  cliUrl: string
  version: string | null
  authenticated: boolean
  login: string | null
  authType: string | null
  statusMessage: string | null
  configuredModel: string | null
  models: CopilotModel[]
  error: string | null
}

export interface EnrichmentJobInfo {
  jobId: string
  deckId: string
  slides: number[]
}

export interface ResearchQueueItem {
  slideNumber: number
  jobId: string
  status: 'Queued' | 'Running'
  cancellationRequested: boolean
}

export interface ResearchQueueState {
  maxConcurrency: number
  items: ResearchQueueItem[]
}

export type DeckEventType = 'connected' | 'heartbeat' | 'slide-status' | 'activity' | 'job' | 'queue'

export interface DeckEvent {
  type: DeckEventType
  deckId: string
  slideNumber: number | null
  jobId: string | null
  status: string | null
  message: string | null
  slide: SlideState | null
  timestamp: string
}

export type ReviewDecision = 'accepted' | 'rejected' | 'pending'
