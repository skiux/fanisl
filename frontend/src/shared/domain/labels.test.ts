import { describe, expect, it } from 'vitest'
import apiDoc from '../../../../backend/api.md?raw'
import domainDoc from '../../../../docs/DOMAIN.md?raw'
import {
  attestationLabels, categoryLabels, claimClassLabels, contentStatusLabels, directionLabels,
  familyLabels, kindLabels, nodeStatusLabels, outcomeLabels, outcomeMarks, relationLabels,
  resolutionOutcomeLabels, reviewCategoryLabels, reviewRoleLabels, reviewStatusLabels,
  stanceLabels, testabilityLabels, tradeOutcomeLabels, tradeStatusLabels, verifiabilityLabels,
} from './labels'

/** DOMAIN.md §4：`**组名**：key=标签 · key=标签`，一组可以折行，交易那行两组挤在一行里。 */
function domainGroups(markdown: string) {
  const section = markdown.split(/^## 4\./m)[1]?.split(/^## 5\./m)[0] ?? ''
  const flat = section.split('\n').slice(1).join(' ')
  const groups = new Map<string, Record<string, string>>()
  for (const match of flat.matchAll(/\*\*([^*]+)\*\*：(.*?)(?=；?\s*\*\*[^*]+\*\*：|$)/g)) {
    const pairs: Record<string, string> = {}
    for (const part of match[2].split(/\s*·\s*/)) {
      const pair = part.trim().match(/^([A-Za-z_]+)=(.+)$/)
      if (pair) pairs[pair[1]] = pair[2].replace(/（[^）]*）$/, '').trim()
    }
    groups.set(match[1], pairs)
  }
  return groups
}

/** api.md §5.6 的枚举表：`| \`字段\` | \`值\` 标签 · \`值\` 标签 |`。 */
function reviewGroups(markdown: string) {
  const section = markdown.split(/^### 5\.6/m)[1]?.split(/^#### /m)[0] ?? ''
  const groups = new Map<string, Record<string, string>>()
  for (const row of section.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)) {
    const pairs: Record<string, string> = {}
    for (const item of row[2].matchAll(/`([a-z_]+)` ([^·`]+)/g)) {
      pairs[item[1]] = item[2].replace(/（[^）]*）/, '').trim()
    }
    groups.set(row[1], pairs)
  }
  return groups
}

describe('枚举标签与文档逐条一致', () => {
  const groups = domainGroups(domainDoc)

  it('解析到了 §4 的全部 15 组——少解析一组就等于那组没被核对', () => {
    expect([...groups.keys()]).toEqual([
      'unit.kind', 'verifiability', 'stance_strength', 'claim_class', 'direction', 'score.outcome',
      'node.status', 'attestation.relation', 'relation（边）', 'method.family', 'method.testability',
      'concept.category', 'content.status', '交易 outcome', 'trade.status',
    ])
  })

  const plain: Array<[string, Record<string, string>]> = [
    ['unit.kind', kindLabels],
    ['verifiability', verifiabilityLabels],
    ['stance_strength', stanceLabels],
    ['claim_class', claimClassLabels],
    ['direction', directionLabels],
    ['node.status', nodeStatusLabels],
    ['attestation.relation', attestationLabels],
    ['relation（边）', relationLabels],
    ['method.family', familyLabels],
    ['method.testability', testabilityLabels],
    ['concept.category', categoryLabels],
    ['content.status', contentStatusLabels],
    ['交易 outcome', tradeOutcomeLabels],
    ['trade.status', tradeStatusLabels],
  ]

  it.each(plain)('%s', (name, labels) => {
    expect(labels).toEqual(groups.get(name))
  })

  it('score.outcome：带符号的三项拆成符号与文字，其余只有文字', () => {
    const doc = groups.get('score.outcome') ?? {}
    const ours = Object.fromEntries(Object.keys(doc).map((key) => [
      key,
      /^[✓½✗] /.test(doc[key]) ? `${outcomeMarks[key]} ${outcomeLabels[key]}` : outcomeLabels[key],
    ]))
    expect(ours).toEqual(doc)
    // 文档之外只多出这一个，是前端补的
    expect(Object.keys(outcomeLabels).filter((key) => !(key in doc))).toEqual(['pending'])
  })

  it('单元核查的四组与 api.md §5.6 一致', () => {
    const reviews = reviewGroups(apiDoc)
    expect(reviewCategoryLabels).toEqual(reviews.get('category'))
    expect(reviewStatusLabels).toEqual(reviews.get('status'))
    expect(reviewRoleLabels).toEqual(reviews.get('messages[].role'))
    expect(resolutionOutcomeLabels).toEqual(reviews.get('resolution.outcome'))
  })
})
