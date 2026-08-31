// 标的页共用的取值与格式化。命中率的展示纪律见 domain-model.md §5：**永远带 n**，
// 没样本时显示「未验证」而不是 0%，n 小于 SMALL_SAMPLE 时视觉降权。

/** 低于这个样本量**不印百分比，改印计数**。
 *
 *  "100% n=9"（美光）与"100% n=1"（Meta）都是真数字，但读者一眼拿到的是错的印象——
 *  百分比在小样本上把噪音说成了本事。"9 中 0 错"信息量相同、长度相近，且不会被误读。
 *  10 起才折算成百分比，并仍然带 n。 */
export const SMALL_SAMPLE = 10

export function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function formatDate(value: string | null | undefined, withYear = false) {
  if (!value) return '—'
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: withYear ? 'numeric' : undefined,
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(date)
}

/** 距今天数；负数表示已经过去。日期不可解析时返回 null。 */
export function daysFromToday(day: string | null | undefined): number | null {
  if (!day) return null
  const target = Date.parse(`${day.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(target)) return null
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((target - today) / 86400000)
}

export function countdown(day: string | null | undefined) {
  const days = daysFromToday(day)
  if (days === null) return '日期未知'
  if (days === 0) return '今天到期'
  if (days === 1) return '明天到期'
  if (days < 0) return `已过期 ${-days} 天`
  if (days < 31) return `${days} 天后`
  if (days < 400) return `${Math.round(days / 30)} 个月后`
  return `${(days / 365).toFixed(1)} 年后`
}

export function percent(rate: number | null) {
  return rate === null ? null : `${Math.round(rate * 100)}%`
}

// 类别在列表里的排序：先大盘与板块，再个股，最后小众品类——按"日常先看什么"排。
const CLASS_ORDER = ['index', 'etf', 'stock', 'metal', 'commodity', 'crypto', 'rate', 'fx', 'preipo']

export function classRank(value: string | null) {
  const index = value ? CLASS_ORDER.indexOf(value) : -1
  return index === -1 ? CLASS_ORDER.length : index
}

export const kindLabels: Record<string, string> = { claim: '判断', method: '方法', concept: '认知' }

export const statusLabels: Record<string, string> = {
  active: '活跃', corroborated: '多源佐证', verified: '已验证',
  contested: '存在争议', retired: '已退役',
}

export const outcomeLabels: Record<string, string> = {
  hit: '命中', partial: '部分命中', miss: '未命中',
  condition_not_met: '条件未触发', condition_unverifiable: '条件不可验',
  unpriceable: '无法取价', pending: '等待确认',
}

export const outcomeMarks: Record<string, string> = {
  hit: '✓', partial: '½', miss: '×',
  condition_not_met: '○', condition_unverifiable: '?', unpriceable: '—', pending: '…',
}

export const directionLabels: Record<string, string> = {
  up: '看涨 ↑', down: '看跌 ↓', flat: '走平 →', range: '区间 ↔',
  vol_up: '波动放大', vol_down: '波动收敛',
}

export const stanceLabels: Record<string, string> = {
  explicit: '明确', hedged: '对冲表述', speculative: '试探表述',
}

export const verifiabilityLabels: Record<string, string> = {
  A: '全自动可评', B: '我方阶梯', C: '带条件', D: '不可评',
}

/** 大额美元：按中文习惯用万亿/亿，不用 B/T——这一页其余数字也都是中文口径。 */
export function usd(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)} 万亿`
  if (abs >= 1e8) return `${(value / 1e8).toFixed(0)} 亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)} 万`
  return value.toFixed(0)
}

export function count(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Intl.NumberFormat('zh-CN').format(value)
}

/** 指标的展示：倍数保留两位，百分比按原口径（Finnhub 给的就是百分数）。 */
export function ratio(value: number | undefined, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : null
}

export function pct(value: number | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}%` : null
}

export const sessionLabels: Record<string, string> = {
  bmo: '盘前', amc: '盘后', dmh: '盘中',
}

export const tradeStatusLabels: Record<string, string> = {
  planned: '挂单', open: '持仓', closed: '已平', cancelled: '已撤',
}

export const tradeOutcomeLabels: Record<string, string> = { win: '盈', loss: '亏' }

export const sideLabels: Record<string, string> = { long: '多', short: '空' }

/** 带符号的百分比：盈亏要一眼看出方向。 */
export function signedPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

/** 命中率的展示决定：样本太小就别给百分比，给计数。 */
export function rateDisplay(record: {
  scored: number
  hits: number
  partials: number
  misses: number
  hit_rate: number | null
}): { text: string; small: boolean; counts: string | null; isRate: boolean } {
  const { scored, hits, partials, misses } = record
  if (scored === 0) return { text: '未验证', small: false, counts: null, isRate: false }
  const counts = [
    hits ? `${hits} 中` : '',
    partials ? `${partials} 部分` : '',
    misses ? `${misses} 错` : '',
  ].filter(Boolean).join(' · ')
  if (scored < SMALL_SAMPLE) {
    return { text: counts || `${scored} 次判定`, small: true, counts, isRate: false }
  }
  return { text: percent(record.hit_rate) ?? '—', small: false, counts, isRate: true }
}

// SIC 行业串（Polygon）与 Finnhub 的行业名混在同一列里，两套词汇都映射。
// 顺带治一个荒谬：奈飞的 SIC 是"录像带租赁"——那是 1997 年注册时填的，照抄出来只会误导。
const INDUSTRY_LABELS: Record<string, string> = {
  'SERVICES-PREPACKAGED SOFTWARE': '软件',
  'SERVICES-COMPUTER PROGRAMMING, DATA PROCESSING, ETC.': '软件与数据服务',
  'SERVICES-BUSINESS SERVICES, NEC': '商业服务',
  'SEMICONDUCTORS & RELATED DEVICES': '半导体',
  'ELECTRONIC COMPUTERS': '计算机硬件',
  'COMPUTER STORAGE DEVICES': '存储设备',
  'RADIO & TV BROADCASTING & COMMUNICATIONS EQUIPMENT': '通信设备',
  'ELECTRONIC & OTHER ELECTRICAL EQUIPMENT (NO COMPUTER EQUIP)': '电子电气设备',
  'ELECTRICAL INDUSTRIAL APPARATUS': '工业电气设备',
  'MOTOR VEHICLES & PASSENGER CAR BODIES': '整车制造',
  'ELECTRIC SERVICES': '电力',
  'FINANCE SERVICES': '金融服务',
  'SECURITY BROKERS, DEALERS & FLOTATION COMPANIES': '券商',
  'COMMODITY CONTRACTS BROKERS & DEALERS': '大宗商品经纪',
  'INVESTMENT ADVICE': '投资顾问',
  'RETAIL-CATALOG & MAIL-ORDER HOUSES': '电商零售',
  'HOSPITAL & MEDICAL SERVICE PLANS': '医疗保险',
  'ORTHOPEDIC, PROSTHETIC & SURGICAL APPLIANCES & SUPPLIES': '医疗器械',
  'SERVICES-MISCELLANEOUS AMUSEMENT & RECREATION': '娱乐',
  'SERVICES-VIDEO TAPE RENTAL': '流媒体',
  Semiconductors: '半导体',
  Technology: '科技',
  Communications: '通信',
}

export function industryLabel(raw: string | null | undefined) {
  if (!raw) return null
  const mapped = INDUSTRY_LABELS[raw] ?? INDUSTRY_LABELS[raw.toUpperCase()]
  if (mapped) return mapped
  // 没登记的照原样给，但别用全大写砸人——SIC 原串是大写的
  return raw.length > 4 && raw === raw.toUpperCase()
    ? raw.charAt(0) + raw.slice(1).toLowerCase()
    : raw
}

const THRESHOLD_LABELS: Record<string, string> = {
  target: '目标', low: '下界', high: '上界', support: '支撑', resistance: '压力', stop: '止损',
}

/**
 * 判断的结构化一行：标的 + 方向 + 阈值。
 *
 * 首页的到期列表原来直接给口语原句（"我们通过这样的多级别的跨周期的观察呢…"），扫不动。
 * 原句是证据，该留在详情里；列表要的是"谁、往哪、过哪个数"。
 */
export function claimHeadline(payload: Record<string, unknown>): string {
  const bits: string[] = []
  const direction = asText(payload.direction)
  if (direction) bits.push(directionLabels[direction] ?? direction)
  const magnitude = asRecord(payload.magnitude)
  if (magnitude) {
    const parts = Object.entries(magnitude)
      .filter(([key]) => key in THRESHOLD_LABELS)
      .flatMap(([key, value]) => {
        const number = asNumber(value)
        return number === null ? [] : [`${THRESHOLD_LABELS[key]} ${number}`]
      })
    bits.push(...parts.slice(0, 2))
  }
  if (bits.length === 0) {
    const kind = asText(payload.claim_class)
    if (kind) bits.push(claimClassLabels[kind] ?? kind)
  }
  const condition = asText(payload.condition_text)
  if (condition) bits.push(`条件：${condition.slice(0, 18)}`)
  return bits.join(' · ')
}

export const claimClassLabels: Record<string, string> = {
  price_target: '价位判断', directional: '方向判断', relative: '相对强弱',
  event_outcome: '事件结果', timing: '时点判断', risk_warning: '风险警示',
}
