import type { ReactNode } from 'react'
import { nextMarkdownHeadingId } from './markdownModel'
import type { ResearchDocName } from './types'

type MarkdownDocumentProps = {
  content: string
  onDocumentSelect: (name: ResearchDocName) => void
}

type RenderContext = {
  headingCounts: Map<string, number>
  onDocumentSelect: (name: ResearchDocName) => void
}

const documentLinkMap: Record<string, ResearchDocName> = {
  'research-capstone.md': 'capstone',
  'research-log.md': 'research-log',
  'trading-eval-repositioning.md': 'eval-repositioning',
  'knowledge-engine-design.md': 'knowledge-engine',
}

function linkedDocument(href: string) {
  const withoutAnchor = href.split('#')[0]
  const basename = withoutAnchor.split('/').pop() ?? ''
  return documentLinkMap[basename] ?? null
}

function renderInline(
  value: string,
  keyPrefix: string,
  onDocumentSelect: (name: ResearchDocName) => void,
): ReactNode[] {
  const tokenPattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)]+\)|\*[^*\n]+\*)/g
  const output: ReactNode[] = []
  let cursor = 0
  let tokenIndex = 0

  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index
    if (index > cursor) output.push(value.slice(cursor, index))
    const token = match[0]
    const key = `${keyPrefix}-${tokenIndex}`

    if (token.startsWith('`')) {
      output.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      output.push(
        <strong key={key}>
          {renderInline(token.slice(2, -2), `${key}-strong`, onDocumentSelect)}
        </strong>,
      )
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) {
        const [, label, href] = link
        const documentName = linkedDocument(href)
        output.push(
          <a
            href={documentName ? `#/archive?doc=${documentName}` : href}
            key={key}
            onClick={documentName
              ? (event) => {
                  event.preventDefault()
                  onDocumentSelect(documentName)
                }
              : undefined}
            rel={documentName ? undefined : 'noreferrer'}
            target={documentName ? undefined : '_blank'}
          >
            {label}
          </a>,
        )
      } else {
        output.push(token)
      }
    } else {
      output.push(
        <em key={key}>
          {renderInline(token.slice(1, -1), `${key}-em`, onDocumentSelect)}
        </em>,
      )
    }

    cursor = index + token.length
    tokenIndex += 1
  }

  if (cursor < value.length) output.push(value.slice(cursor))
  return output
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isTableDivider(line: string) {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? ''
  if (!line.trim()) return true
  if (/^#{1,6}\s+/.test(line)) return true
  if (/^\s*```/.test(line)) return true
  if (/^\s*>/.test(line)) return true
  if (/^\s*([-*+])\s+/.test(line)) return true
  if (/^\s*\d+[.)]\s+/.test(line)) return true
  if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) return true
  return line.includes('|') && isTableDivider(lines[index + 1] ?? '')
}

function renderBlocks(content: string, context: RenderContext) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let blockIndex = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const fence = trimmed.match(/^```([\w-]*)/)
    if (fence) {
      const language = fence[1]
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(
        <div className="archive-code-block" key={`code-${blockIndex}`}>
          <span>{language || 'TEXT'}</span>
          <pre><code>{code.join('\n')}</code></pre>
        </div>,
      )
      blockIndex += 1
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const text = heading[2].trim()
      const id = nextMarkdownHeadingId(text, context.headingCounts)
      const children = renderInline(text, `heading-${blockIndex}`, context.onDocumentSelect)
      if (level === 1) blocks.push(<h1 id={id} key={id}>{children}</h1>)
      if (level === 2) blocks.push(<h2 id={id} key={id}>{children}</h2>)
      if (level === 3) blocks.push(<h3 id={id} key={id}>{children}</h3>)
      if (level === 4) blocks.push(<h4 id={id} key={id}>{children}</h4>)
      if (level === 5) blocks.push(<h5 id={id} key={id}>{children}</h5>)
      if (level === 6) blocks.push(<h6 id={id} key={id}>{children}</h6>)
      index += 1
      blockIndex += 1
      continue
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${blockIndex}`} />)
      index += 1
      blockIndex += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push(
        <blockquote key={`quote-${blockIndex}`}>
          {renderBlocks(quoteLines.join('\n'), {
            ...context,
            headingCounts: new Map(),
          })}
        </blockquote>,
      )
      blockIndex += 1
      continue
    }

    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const header = tableCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      blocks.push(
        <div className="archive-table-wrap" key={`table-${blockIndex}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={`head-${cellIndex}`}>
                    {renderInline(cell, `table-${blockIndex}-head-${cellIndex}`, context.onDocumentSelect)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <td key={`cell-${cellIndex}`}>
                      {renderInline(
                        row[cellIndex] ?? '',
                        `table-${blockIndex}-${rowIndex}-${cellIndex}`,
                        context.onDocumentSelect,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      blockIndex += 1
      continue
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      const orderedList = Boolean(ordered)
      const items: string[] = []
      const pattern = orderedList ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/
      while (index < lines.length) {
        const item = lines[index].match(pattern)
        if (!item) break
        const parts = [item[1]]
        index += 1
        while (
          index < lines.length
          && lines[index].trim()
          && !isBlockStart(lines, index)
          && /^\s{2,}/.test(lines[index])
        ) {
          parts.push(lines[index].trim())
          index += 1
        }
        items.push(parts.join(' '))
      }
      const children = items.map((item, itemIndex) => (
        <li key={`item-${itemIndex}`}>
          {renderInline(item, `list-${blockIndex}-${itemIndex}`, context.onDocumentSelect)}
        </li>
      ))
      blocks.push(orderedList
        ? <ol key={`list-${blockIndex}`}>{children}</ol>
        : <ul key={`list-${blockIndex}`}>{children}</ul>)
      blockIndex += 1
      continue
    }

    const paragraph = [trimmed]
    index += 1
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(
      <p key={`paragraph-${blockIndex}`}>
        {renderInline(
          paragraph.join(' '),
          `paragraph-${blockIndex}`,
          context.onDocumentSelect,
        )}
      </p>,
    )
    blockIndex += 1
  }

  return blocks
}

function MarkdownDocument({
  content,
  onDocumentSelect,
}: MarkdownDocumentProps) {
  return (
    <div className="archive-markdown">
      {renderBlocks(content, {
        headingCounts: new Map(),
        onDocumentSelect,
      })}
    </div>
  )
}

export default MarkdownDocument
