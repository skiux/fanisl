import type { StripTone } from '../components/Strip'

/**
 * 风险阈值。**全站只有这一份。**
 *
 * 之前同一个合约保证金率在同一屏上按三套标准判：风险仪表的配色在 0.6 转红，
 * 而它自己在 0.8 处画着一条"危险线"（进度条早在红线之前就红了），摘要条又是
 * 第三套。数字还印了两遍精度——摘要条 `4.5%`、仪表 `4.46%`，看着像两个数。
 *
 * 现在配色、判语、仪表上那条线都取自这里：
 *
 *   合约保证金率 = 维持保证金 / 保证金余额，**到 100% 就是强平**。
 *   过半（0.5）该看一眼，到 0.8 只剩两成缓冲，是"现在就得动"那条线——
 *   仪表上的标记线本来画的就是 0.8，让判色跟它对齐，而不是反过来。
 *
 * 全仓杠杆的 `marginLevel` 语义相反：越小越危险，币安 1.3 预警、1.1 强平。
 */
export const MARGIN_RATIO_TIGHT = 0.5
export const MARGIN_RATIO_DANGER = 0.8

export const MARGIN_LEVEL_SAFE = 2
export const MARGIN_LEVEL_WARN = 1.3

/**
 * 单个仓位的强平距离：另一把尺，别跟保证金率混。
 * 满格取 50%——再远就没有分辨意义了，仓位条会一直是满的。
 */
export const LIQ_DISTANCE_FULL = 0.5
export const LIQ_DISTANCE_TIGHT = 0.35
export const LIQ_DISTANCE_DANGER = 0.2

/** 距强平越近条越满：与保证金率同向，"变满 = 变危险" */
export function liqDistanceRisk(distance: number | null): { fill: number; tone: StripTone } {
  if (distance === null) return { fill: 0, tone: 'muted' }
  const fill = Math.max(0, Math.min(1, 1 - distance / LIQ_DISTANCE_FULL))
  const tone: StripTone = distance <= LIQ_DISTANCE_DANGER ? 'loss'
    : distance <= LIQ_DISTANCE_TIGHT ? 'warn' : 'muted'
  return { fill, tone }
}

export type RiskTone = { tone: StripTone; label: string }

export function marginRatioRisk(ratio: number): RiskTone {
  if (ratio >= MARGIN_RATIO_DANGER) return { tone: 'loss', label: '危险' }
  if (ratio >= MARGIN_RATIO_TIGHT) return { tone: 'warn', label: '偏紧' }
  return { tone: 'gain', label: '安全' }
}

export function marginLevelRisk(level: number): RiskTone {
  if (level >= MARGIN_LEVEL_SAFE) return { tone: 'gain', label: '安全' }
  if (level >= MARGIN_LEVEL_WARN) return { tone: 'warn', label: '偏紧' }
  return { tone: 'loss', label: '接近强平' }
}

const TEXT: Record<StripTone, string> = {
  gain: 'text-gain', loss: 'text-loss', warn: 'text-accent', muted: 'text-ink-3',
}
const BAR: Record<StripTone, string> = {
  gain: 'bg-gain', loss: 'bg-loss', warn: 'bg-accent', muted: 'bg-ink-3',
}

export const riskText = (tone: StripTone) => TEXT[tone]
export const riskBar = (tone: StripTone) => BAR[tone]
