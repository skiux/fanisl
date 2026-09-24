// 枚举 → 中文标签，前端只有这一份。
//
// docs/DOMAIN.md §4 是全站文案的口径（"勿在组件里另起译名"），单元核查的四组取自
// backend/api.md §5.6。之前同一个枚举在七个文件里各写一份，partial 有"部分"与"部分命中"、
// unpriceable 有"无价格"与"无法取价"、risk_mgmt 有"风控"与"风险管理"——同一条数据换个页面
// 就换个说法。labels.test.ts 逐条对照那两份文档，文档改了这里会红。
//
// 文档里没有定义、由前端补的（评分方法、实测字段、pending 与各结果的符号）也只写在这里，
// 并在测试里单列出来，免得混进"与文档一致"的那一批。

export function labelOf(map: Record<string, string>, value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return map[value] ?? value
}

export const kindLabels: Record<string, string> = {
  claim: '判断', method: '方法', concept: '认知',
}

export const verifiabilityLabels: Record<string, string> = {
  A: '全自动', B: '我方阶梯', C: '带条件', D: '不可评',
}

/** "B级 · 我方阶梯"。等级字母本身是信息，标签是解释，两者都要。 */
export function gradeText(grade: unknown): string | null {
  if (typeof grade !== 'string' || !grade) return null
  const label = verifiabilityLabels[grade]
  return label ? `${grade}级 · ${label}` : grade
}

export const stanceLabels: Record<string, string> = {
  explicit: '明确', hedged: '对冲表述', speculative: '试探表述',
}

export const claimClassLabels: Record<string, string> = {
  price_target: '价位判断', directional: '方向判断', relative: '相对强弱',
  event_outcome: '事件结果', timing: '时点判断', risk_warning: '风险警示',
}

export const directionLabels: Record<string, string> = {
  up: '↑', down: '↓', flat: '→', range: '↔', vol_up: '波动↑', vol_down: '波动↓',
}

export const outcomeLabels: Record<string, string> = {
  hit: '命中', partial: '部分', miss: '未中',
  condition_not_met: '条件未触发', condition_unverifiable: '条件不可验', unpriceable: '无价格',
  // 以下为前端补充：DOMAIN.md 没有 pending，api.md 把它与 condition_not_met 同归"需复核"
  pending: '待复核',
}

export const outcomeMarks: Record<string, string> = {
  hit: '✓', partial: '½', miss: '✗',
  // 以下为前端补充：列表里需要一个等宽的符号位
  condition_not_met: '○', condition_unverifiable: '?', unpriceable: '—', pending: '…',
}

/** 列表里的一格："✓ 命中"。DOMAIN.md 里只有命中/部分/未中带符号，其余只给文字。 */
export function outcomeText(outcome: string): string {
  const label = outcomeLabels[outcome] ?? outcome
  return ['hit', 'partial', 'miss'].includes(outcome) ? `${outcomeMarks[outcome]} ${label}` : label
}

export const nodeStatusLabels: Record<string, string> = {
  active: '活跃', corroborated: '多源佐证', verified: '已验证', contested: '存在争议', retired: '已退役',
}

export const attestationLabels: Record<string, string> = {
  restates: '重申', refines: '细化', supersedes: '修正', contradicts: '反驳',
}

export const relationLabels: Record<string, string> = {
  conflicts: '对立', relates: '关联',
}

export const familyLabels: Record<string, string> = {
  trend: '趋势', reversion: '回归', carry: '套息', event: '事件', flow: '资金流',
  positioning: '仓位', other: '其他',
}

export const testabilityLabels: Record<string, string> = {
  A: '可回测', B: '缺数据', C: '不可机械化',
}

export const categoryLabels: Record<string, string> = {
  risk_mgmt: '风控', psychology: '心理', market_structure: '市场结构', regime: '市场环境',
  execution: '执行', macro_framework: '宏观框架', other: '其他',
}

export const contentStatusLabels: Record<string, string> = {
  new: '待提取', extracted: '已提取',
}

export const tradeOutcomeLabels: Record<string, string> = { win: '盈', loss: '亏' }

export const tradeStatusLabels: Record<string, string> = {
  planned: '挂单', open: '持仓', closed: '已平', cancelled: '已撤',
}

// ---- 前端补充（两份文档都没有定义）----

/** horizon.type。有截止日或天数时直接写日期与天数，这里只在两者都没有时用 */
export const horizonTypeLabels: Record<string, string> = {
  by_date: '按日期', within_duration: '限期内', open_ended: '原文未给期限',
}

export const scoringMethodLabels: Record<string, string> = {
  sign: '方向符号', target_touch: '目标触及', target_close: '到期收盘',
  range_hold: '区间保持', relative_return: '相对收益',
}

/** 评分器落库的实测字段。原先单元档案与判定档案各有一份，"ref"一边叫参考价一边叫发布参考。 */
export const realizedLabels: Record<string, string> = {
  ref: '发布参考价', eval_close: '到期收盘', asset_ret: '标的收益', bench_ret: '基准收益',
  excess_ret: '超额收益', relative_ret: '相对收益', target: '判定目标',
  high: '区间最高', low: '区间最低', ladder: '评分日期', condition: '条件观测',
  cond_date: '条件成立日', max_dd: '最大回撤',
}

// ---- 单元核查（backend/api.md §5.6）----

export const reviewCategoryLabels: Record<string, string> = {
  quote: '原句', grade: '分级', scoring: '评分规格', asset: '标的与标签', statement: '结论表述', other: '其他',
}

export const reviewStatusLabels: Record<string, string> = {
  open: '待知识席位答复', answered: '待你确认', closed: '已关闭',
}

export const reviewRoleLabels: Record<string, string> = {
  reviewer: '你', extractor: '知识席位',
}

export const resolutionOutcomeLabels: Record<string, string> = {
  fixed: '已修改', no_change: '维持原判', needs_info: '需要你补充',
}
