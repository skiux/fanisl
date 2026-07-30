/*
 * Enum -> 中文标签，单一来源（对应 domain-model.md §4）。
 * 组件里不要另起译名。
 */

export const kindLabels: Record<string, string> = {
  claim: '判断',
  method: '方法',
  concept: '认知',
}

export const nodeStatusLabels: Record<string, string> = {
  active: '活跃',
  corroborated: '重复表达',
  verified: '已验证',
  contested: '存在争议',
  retired: '已退役',
}

export const attestationLabels: Record<string, string> = {
  restates: '重申',
  refines: '细化',
  supersedes: '修正',
  contradicts: '反驳',
}

export const relationLabels: Record<string, string> = {
  conflicts: '对立',
  relates: '关联',
}

export const outcomeLabels: Record<string, string> = {
  hit: '命中',
  partial: '部分命中',
  miss: '未中',
  condition_not_met: '条件未触发',
  condition_unverifiable: '条件不可验',
  unpriceable: '无价格',
  pending: '等待复核',
}

export const directionLabels: Record<string, string> = {
  up: '看涨',
  down: '看跌',
  flat: '走平',
  range: '区间震荡',
  vol_up: '波动放大',
  vol_down: '波动收敛',
}

export const claimClassLabels: Record<string, string> = {
  price_target: '价位',
  directional: '方向',
  relative: '相对强弱',
  event_outcome: '事件结果',
  timing: '时点',
  risk_warning: '风险警示',
}

export const scoringMethodLabels: Record<string, string> = {
  sign: '方向对照参考价',
  target_touch: '期限内触及目标',
  target_close: '到期收盘落在目标带',
  range_hold: '判界持续不破',
  relative_return: '相对基准收益',
}

export const familyLabels: Record<string, string> = {
  trend: '趋势',
  reversion: '回归',
  carry: '套息',
  event: '事件',
  flow: '资金流',
  positioning: '仓位',
  other: '其他',
}

export const categoryLabels: Record<string, string> = {
  risk_mgmt: '风控',
  psychology: '心理',
  market_structure: '市场结构',
  regime: '市场环境',
  execution: '执行',
  macro_framework: '宏观框架',
  other: '其他',
}

export const verifiabilityLabels: Record<string, string> = {
  A: '全自动',
  B: '我方阶梯',
  C: '带条件',
  D: '不可评',
}

export const testabilityLabels: Record<string, string> = {
  A: '可回测',
  B: '缺数据',
  C: '不可机械化',
}

/** 只有 claim 会进入评分器；method/concept 没有评分口径。 */
export function isScorableKind(kind: string) {
  return kind === 'claim'
}

/**
 * corroborated 的判据是「≥2 篇内容」，不是「≥2 位信源」。
 * 同一位作者隔期重复不是佐证，只有 n_creators≥2 才叫跨源。
 */
export function nodeReach(node: { n_attest: number; n_creators: number }) {
  if (node.n_creators >= 2) return { label: '跨源', cross: true }
  if (node.n_attest >= 2) return { label: '同源重复', cross: false }
  return { label: '单次提及', cross: false }
}

/**
 * 节点标题由 seed_singletons 机械截断生成：全库 105 个里 70 个是 canonical 的
 * 字面前缀，其中 31 个在第 30 字处断开。直接把 title 和 canonical 并排显示，
 * 就会出现同一句话先断一次、再完整印一次。
 */
export function titleIsPrefixOfCanonical(title: string, canonical: string) {
  if (!title || !canonical) return false
  const head = title.slice(0, Math.min(12, title.length))
  return title.length > 8 && canonical.startsWith(head)
}

const CLAUSE_BREAKS = ['——', '：', '；', '。', '，', '（', '(', '=']

/**
 * 节点的显示标题：标题是截断前缀时，改从 canonical 切一个完整短句作标题，
 * 避免断句。返回 needsBody=false 表示标题已覆盖 canonical，不必再重复正文。
 */
export function nodeHeading(node: { title: string; canonical: string }) {
  const { title, canonical } = node
  if (!titleIsPrefixOfCanonical(title, canonical)) {
    return { heading: title, body: canonical, needsBody: canonical !== title }
  }

  const window = canonical.slice(0, 34)

  // 1) 句读边界：取最靠前的一个，保证标题是完整短句
  let cut = -1
  for (const mark of CLAUSE_BREAKS) {
    const index = window.indexOf(mark)
    if (index >= 8 && (cut < 0 || index < cut)) cut = index
  }
  if (cut > 0) {
    return { heading: canonical.slice(0, cut), body: canonical, needsBody: true }
  }

  // 2) 退一步找并列分隔符，从右往左取最长的完整片段
  for (const mark of ['/', '、', ' ']) {
    const index = canonical.slice(0, 26).lastIndexOf(mark)
    if (index >= 10) {
      return { heading: canonical.slice(0, index), body: canonical, needsBody: true }
    }
  }

  // 3) 只能硬截时补省略号——截断要看得出是截断，不能伪装成完整句子
  if (canonical.length > 26) {
    return { heading: `${canonical.slice(0, 24)}…`, body: canonical, needsBody: true }
  }
  return { heading: canonical, body: canonical, needsBody: false }
}
