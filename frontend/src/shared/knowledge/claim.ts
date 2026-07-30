/*
 * 把 claim 的 payload 归一化成可扫读的主张行。
 *
 * 列表的标题必须是主张（标的 + 方向 + 目标 + 期限），逐字引文是证据、放在下面。
 * 反过来做的话，列表就是一串口语长句，无法扫读。
 */

import {
  claimClassLabels,
  directionLabels,
  scoringMethodLabels,
  verifiabilityLabels,
} from './labels'

type Payload = Record<string, unknown>

function asRecord(value: unknown): Payload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Payload
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return formatNumber(value)
  return null
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

/** 目标/区间/幅度 → 一段短文本 */
export function magnitudeText(payload: Payload): string | null {
  const magnitude = asRecord(payload.magnitude)
  if (!magnitude) return null

  const target = asText(magnitude.target)
  if (target) return `目标 ${target}`

  const low = asText(magnitude.low ?? magnitude.min ?? magnitude.from)
  const high = asText(magnitude.high ?? magnitude.max ?? magnitude.to)
  if (low && high) return `区间 ${low}–${high}`
  if (low) return `下界 ${low}`
  if (high) return `上界 ${high}`

  const pct = magnitude.pct ?? magnitude.percent ?? magnitude.change_pct
  if (typeof pct === 'number') return `幅度 ${pct > 0 ? '+' : ''}${formatNumber(pct)}%`

  const level = asText(magnitude.level ?? magnitude.value)
  if (level) return `水平 ${level}`
  return null
}

/** 标的：优先原文表述，其次规范符号 */
export function subjectText(payload: Payload): string {
  return asText(payload.asset_text)
    ?? asText(payload.asset_symbol)
    ?? '无规范标的'
}

export function symbolText(payload: Payload): string | null {
  return asText(payload.asset_symbol)
}

/** 期限：到期日优先，否则用我方窗口天数 */
export function horizonText(payload: Payload, horizonLabel?: string | null): string | null {
  if (horizonLabel) return `到期 ${horizonLabel}`
  const horizon = asRecord(payload.horizon)
  const deadline = asText(horizon?.deadline)
  if (deadline) return `到期 ${deadline.slice(0, 10)}`
  const days = horizon?.duration_days
  if (typeof days === 'number') return `${formatNumber(days)} 天窗口`
  return null
}

/**
 * 主张行：方向 + 目标 + 类别。
 * 命题本身，不含标的与期限（那两项单独排版）。
 */
export function thesisText(payload: Payload): string {
  const parts: string[] = []
  const direction = asText(payload.direction)
  if (direction) parts.push(directionLabels[direction] ?? direction)
  const magnitude = magnitudeText(payload)
  if (magnitude) parts.push(magnitude)
  if (!parts.length) {
    const claimClass = asText(payload.claim_class)
    if (claimClass) parts.push(claimClassLabels[claimClass] ?? claimClass)
  }
  return parts.join(' · ')
}

export function claimClassText(payload: Payload): string | null {
  const value = asText(payload.claim_class)
  if (!value) return null
  return claimClassLabels[value] ?? value
}

export function verifiabilityText(payload: Payload): { grade: string; label: string } | null {
  const grade = asText(payload.verifiability)
  if (!grade) return null
  return { grade, label: verifiabilityLabels[grade] ?? grade }
}

export function scoringMethodText(payload: Payload): string | null {
  const spec = asRecord(payload.scoring_spec)
  const method = asText(spec?.method)
  if (!method) return null
  return scoringMethodLabels[method] ?? method
}

export function benchmarkText(payload: Payload): string | null {
  const spec = asRecord(payload.scoring_spec)
  return asText(spec?.benchmark)
}

export function successDef(payload: Payload): string | null {
  const spec = asRecord(payload.scoring_spec)
  return asText(spec?.success_def)
}

export function conditionText(payload: Payload): string | null {
  return asText(payload.condition_text)
}

export function evalLadder(payload: Payload): string[] {
  const spec = asRecord(payload.scoring_spec)
  const ladder = spec?.eval_ladder
  if (!Array.isArray(ladder)) return []
  return ladder.filter((item): item is string => typeof item === 'string')
}

/**
 * 列表里那一格「裁决」到底该写什么。
 *
 * 不能一律写「等待验证」：D 级判断根本没有判据，永远不会有评分；
 * 未到期的有冻结的阶梯日期，该把日期写出来；已判定的写结果。
 */
export function claimVerdictLine(
  payload: Payload,
  scores: Array<{ horizon_label: string; outcome: string }>,
  today = new Date(),
): { kind: 'settled' | 'due' | 'unscorable'; text: string } {
  const settled = scores.filter((score) => score.outcome !== 'pending')
  if (settled.length) {
    return { kind: 'settled', text: '' }
  }

  const grade = asText(payload.verifiability)
  if (grade === 'D' || !asRecord(payload.scoring_spec)) {
    return { kind: 'unscorable', text: '无判据，不进评分' }
  }

  const ladder = evalLadder(payload)
  const stamp = today.toISOString().slice(0, 10)
  const upcoming = ladder.filter((date) => date >= stamp).sort()
  if (upcoming.length) {
    return {
      kind: 'due',
      text: ladder.length > 1
        ? `待 ${upcoming[0]} 判定（共 ${ladder.length} 个时点）`
        : `待 ${upcoming[0]} 判定`,
    }
  }
  if (ladder.length) {
    return { kind: 'due', text: `${ladder[ladder.length - 1]} 已到期，未写入评分` }
  }
  return { kind: 'unscorable', text: '无评分时点' }
}

/** 实测结果 → 一行对照文本，相对类判断要把基准一起写出来 */
export function realizedSummary(realized: Record<string, unknown> | null): string | null {
  if (!realized) return null
  const assetRet = realized.asset_ret
  const benchRet = realized.bench_ret
  if (typeof assetRet === 'number' && typeof benchRet === 'number') {
    return `${formatPct(assetRet)} vs 基准 ${formatPct(benchRet)}`
  }
  if (typeof assetRet === 'number') return formatPct(assetRet)
  const evalClose = realized.eval_close
  const ref = realized.ref
  if (typeof evalClose === 'number' && typeof ref === 'number') {
    return `${formatNumber(ref)} → ${formatNumber(evalClose)}`
  }
  if (typeof evalClose === 'number') return `收 ${formatNumber(evalClose)}`
  // realized 只有一段说明文字时不进列表——那是判定档案里的内容，列表放不下也不该放
  return null
}

function formatPct(value: number) {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}
