import type { MarkdownHeading, ResearchDocumentStats } from './types'

export function plainMarkdownText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugBase(value: string) {
  const slug = plainMarkdownText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')
  return slug || 'section'
}

export function nextMarkdownHeadingId(value: string, counts: Map<string, number>) {
  const base = slugBase(value)
  const count = (counts.get(base) ?? 0) + 1
  counts.set(base, count)
  return count === 1 ? base : `${base}-${count}`
}

export function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  const counts = new Map<string, number>()
  return content
    .replace(/```[\s\S]*?```/g, '')
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/)
      if (!match) return []
      return [{
        id: nextMarkdownHeadingId(match[2], counts),
        level: match[1].length,
        text: plainMarkdownText(match[2]),
      }]
    })
}

export function extractDocumentExcerpt(content: string) {
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line || line.startsWith('#') || line === '---') continue
    if (line.startsWith('```') || line.startsWith('|')) continue
    const parts = [line.replace(/^>\s?/, '').replace(/^[-*+]\s+/, '')]
    while (index + 1 < lines.length && lines[index + 1].trim()) {
      const next = lines[index + 1].trim()
      if (next.startsWith('#') || next.startsWith('|') || next.startsWith('```')) break
      parts.push(next.replace(/^>\s?/, '').replace(/^[-*+]\s+/, ''))
      index += 1
    }
    const excerpt = plainMarkdownText(parts.join(' '))
    if (excerpt) return excerpt
  }
  return '这份档案没有可提取的摘要。'
}

export function documentStats(content: string): ResearchDocumentStats {
  const characters = content.replace(/\s/g, '').length
  const verdicts = new Set(
    Array.from(content.matchAll(/\bH\d{1,2}b?\b/gi), (match) => match[0].toUpperCase()),
  ).size
  return {
    characters,
    headings: extractMarkdownHeadings(content).length,
    minutes: Math.max(1, Math.ceil(characters / 460)),
    verdicts,
  }
}
