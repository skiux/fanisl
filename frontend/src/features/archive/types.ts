export type ResearchDocName =
  | 'capstone'
  | 'research-log'
  | 'eval-repositioning'
  | 'knowledge-engine'

export type ResearchDocSummary = {
  name: ResearchDocName
  title: string
}

export type ResearchDocument = ResearchDocSummary & {
  path: string
  content: string
}

export type ArchiveCategory = 'all' | 'closure' | 'method'

export type MarkdownHeading = {
  id: string
  level: number
  text: string
}

export type ResearchDocumentStats = {
  characters: number
  headings: number
  minutes: number
  verdicts: number
}
