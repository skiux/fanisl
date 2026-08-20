import { earn, income, margin, positions, transfers } from './fixtures'
import { PRICE } from './prices'
import type {
  LedgerEntry, LedgerGroup, LedgerKind, LedgerSnapshot, LedgerSourceWindow,
  SourceKey, SourceState, WalletKind,
} from './types'

/** 确定性伪随机：fixture 每次刷新要长一个样，不然没法比对改动 */
function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const WINDOW_DAYS = 30
const MS_DAY = 86_400_000

const usd = (asset: string, amount: number) => {
  const price = PRICE[asset]
  return price === null || price === undefined ? null : amount * price
}

type Draft = {
  kind: LedgerKind
  source: SourceKey
  asset: string
  symbol?: string
  amount: number
  at: number
  wallet?: WalletKind
  counterparty?: WalletKind
  fromAsset?: string
  fromAmount?: number | null
  network?: string
  txId?: string
  status?: LedgerEntry['status']
}

const GROUP_OF: Record<LedgerKind, LedgerGroup> = {
  deposit: 'external', withdraw: 'external',
  realized_pnl: 'income', funding_fee: 'income', commission: 'income',
  referral_kickback: 'income', insurance_clear: 'income',
  earn_reward: 'income', margin_interest: 'income',
  transfer: 'internal', convert: 'internal', dust: 'internal',
}

/**
 * 把一组原始权重缩放到给定合计。资产页的 30 天收支合计是既定的，
 * 流水必须逐条加起来正好等于它——两页对不上账，这一页就没有存在意义。
 */
function scaleTo(values: number[], total: number) {
  const sum = values.reduce((acc, value) => acc + value, 0)
  if (sum === 0) return values.map(() => 0)
  return values.map((value) => (value * total) / sum)
}

function buildDrafts(end: number): Draft[] {
  const drafts: Draft[] = []
  const random = rng(20260821)
  const start = end - WINDOW_DAYS * MS_DAY

  // 资金费：每个永续每 8 小时结算一次，30 天 = 3 符号 × 90 次
  const fundingSlots: { symbol: string; at: number }[] = []
  for (const position of positions) {
    for (let slot = 0; slot < WINDOW_DAYS * 3; slot += 1) {
      fundingSlots.push({ symbol: position.symbol, at: start + slot * (MS_DAY / 3) + 60_000 })
    }
  }
  // 多头付、空头收：权重按仓位方向偏，再整体缩放到 income.funding_fee
  const fundingRaw = fundingSlots.map(({ symbol }) => {
    const position = positions.find((item) => item.symbol === symbol)
    const long = (position?.position_amt ?? 0) > 0
    return (long ? 1 : -0.35) * (0.4 + random())
  })
  scaleTo(fundingRaw, income.funding_fee).forEach((amount, index) => {
    drafts.push({
      kind: 'funding_fee', source: 'income', asset: 'USDT', amount,
      symbol: fundingSlots[index].symbol,
      at: fundingSlots[index].at, wallet: 'usdm_futures',
    })
  })

  // 已实现盈亏：平仓那几笔
  const symbols = positions.map((position) => position.symbol)
  const realizedAt = Array.from({ length: 14 }, () => start + random() * WINDOW_DAYS * MS_DAY)
    .sort((a, b) => a - b)
  const realizedRaw = realizedAt.map(() => 0.2 + random() * 1.6)
  scaleTo(realizedRaw, income.realized_pnl).forEach((amount, index) => {
    drafts.push({
      kind: 'realized_pnl', source: 'income', asset: 'USDT', amount,
      symbol: symbols[index % symbols.length],
      at: realizedAt[index], wallet: 'usdm_futures',
    })
  })

  // 手续费：开平各扣一次，笔数比平仓多
  const commissionAt = Array.from({ length: 26 }, () => start + random() * WINDOW_DAYS * MS_DAY)
    .sort((a, b) => a - b)
  const commissionRaw = commissionAt.map(() => -(0.3 + random()))
  scaleTo(commissionRaw, income.commission).forEach((amount, index) => {
    drafts.push({
      kind: 'commission', source: 'income', asset: 'USDT', amount,
      symbol: symbols[index % symbols.length],
      at: commissionAt[index], wallet: 'usdm_futures',
    })
  })

  const kickbackAt = Array.from({ length: 4 }, (_, index) => start + (index + 0.5) * 7 * MS_DAY)
  scaleTo(kickbackAt.map(() => 1), income.referral_kickback).forEach((amount, index) => {
    drafts.push({
      kind: 'referral_kickback', source: 'income', asset: 'USDT', amount,
      at: kickbackAt[index], wallet: 'usdm_futures',
    })
  })

  // 理财派息：按各产品自己的年化逐日计息，不另编数
  for (const product of earn) {
    if (product.apr === null) continue
    const daily = (product.amount * product.apr) / 365
    for (let day = 1; day <= WINDOW_DAYS; day += 1) {
      drafts.push({
        kind: 'earn_reward', source: 'earn_rewards', asset: product.asset,
        amount: daily, at: start + day * MS_DAY - 3 * 3600_000, wallet: 'earn',
      })
    }
  }

  // 杠杆利息：按负债日息计，PERIODIC
  const dailyInterest = (margin.total_liability_usd * 0.073) / 365
  for (let day = 1; day <= WINDOW_DAYS; day += 1) {
    drafts.push({
      kind: 'margin_interest', source: 'margin_interest', asset: 'USDT',
      amount: -dailyInterest, at: start + day * MS_DAY - 8 * 3600_000, wallet: 'cross_margin',
    })
  }

  // 充值：合计锁死在 transfers.deposits_usd，第二笔用 BTC 吸收余数
  const firstDeposit = 3000
  const btcAmount = (transfers.deposits_usd - firstDeposit * (PRICE.USDT as number)) / (PRICE.BTC as number)
  drafts.push({
    kind: 'deposit', source: 'deposits', asset: 'USDT', amount: firstDeposit,
    at: start + 4.2 * MS_DAY, wallet: 'spot', network: 'TRX',
    txId: '9a41c0f2e7b84d1c9f3a55e0d7c81b6a',
  })
  drafts.push({
    kind: 'deposit', source: 'deposits', asset: 'BTC', amount: btcAmount,
    at: start + 18.6 * MS_DAY, wallet: 'spot', network: 'BTC',
    txId: '3f7d29c4b1a06e58d2c9f4a71b83e05d',
  })

  // 提现：一笔 ETH，合计锁死在 transfers.withdrawals_usd
  drafts.push({
    kind: 'withdraw', source: 'withdrawals', asset: 'ETH',
    amount: -transfers.withdrawals_usd / (PRICE.ETH as number),
    at: start + 23.1 * MS_DAY, wallet: 'spot', network: 'ETH',
    txId: 'd05b8e73a2c41f96e8b207c5da39146f',
  })

  // 钱包划转：净值不变，只是钱换了个地方
  const moves: [WalletKind, WalletKind, string, number, number][] = [
    ['spot', 'usdm_futures', 'USDT', 2500, 5.4],
    ['usdm_futures', 'spot', 'USDT', 1200, 12.8],
    ['spot', 'earn', 'USDT', 1500, 16.2],
    ['spot', 'cross_margin', 'USDT', 800, 25.7],
  ]
  for (const [from, to, asset, amount, day] of moves) {
    // 划转记的是"搬了多少"，不是"少了多少"——它不改变净值
    drafts.push({
      kind: 'transfer', source: 'wallet_transfers', asset,
      amount, at: start + day * MS_DAY, wallet: from, counterparty: to,
    })
  }

  // 闪兑与小额兑换：币种之间换手
  drafts.push({
    kind: 'convert', source: 'convert', asset: 'SOL', amount: 8.4,
    fromAsset: 'USDT', fromAmount: -8.4 * 187.44,
    at: start + 9.3 * MS_DAY, wallet: 'spot',
  })
  drafts.push({
    kind: 'convert', source: 'convert', asset: 'USDT', amount: 640.2,
    fromAsset: 'ARB', fromAmount: -640.2 / 0.7431,
    at: start + 21.5 * MS_DAY, wallet: 'spot',
  })
  drafts.push({
    kind: 'dust', source: 'dust', asset: 'BNB', amount: 0.0781,
    fromAsset: '14 种小额资产', fromAmount: null,
    at: start + 27.4 * MS_DAY, wallet: 'spot',
  })

  return drafts.sort((a, b) => b.at - a.at)
}

export function buildLedgerEntries(asOf: Date): LedgerEntry[] {
  return buildDrafts(asOf.getTime()).map((draft, index) => ({
    id: `${draft.source}:${index}`,
    kind: draft.kind,
    group: GROUP_OF[draft.kind],
    symbol: draft.symbol ?? null,
    source: draft.source,
    time: new Date(draft.at).toISOString(),
    asset: draft.asset,
    amount: draft.amount,
    value_usd: usd(draft.asset, draft.amount),
    wallet: draft.wallet ?? null,
    counterparty: draft.counterparty ?? null,
    from_asset: draft.fromAsset ?? null,
    from_amount: draft.fromAmount ?? null,
    from_value_usd: draft.fromAsset && draft.fromAmount != null
      ? usd(draft.fromAsset, draft.fromAmount)
      : null,
    network: draft.network ?? null,
    tx_id: draft.txId ?? null,
    status: draft.status ?? 'confirmed',
  }))
}

/**
 * 各来源自己的窗口。整条时间线一次能查多久，等于这一列里最小的那个——
 * 这不是脚注，是这一页能给出什么的边界。
 */
export const LEDGER_WINDOWS: LedgerSourceWindow[] = [
  { calls: 1, key: 'deposits', endpoint: 'GET /sapi/v1/capital/deposit/hisrec', weight: 1, max_window_days: 90, lookback_days: 90, fanout: null },
  { calls: 1, key: 'withdrawals', endpoint: 'GET /sapi/v1/capital/withdraw/history', weight: 18000, max_window_days: 90, lookback_days: 90, fanout: null },
  { calls: 1, key: 'income', endpoint: 'GET /fapi/v1/income', weight: 30, max_window_days: null, lookback_days: 90, fanout: null },
  { calls: 40, key: 'wallet_transfers', endpoint: 'GET /sapi/v1/asset/transfer', weight: 1, max_window_days: null, lookback_days: 180, fanout: 'type 必填，约 40 种要逐个问' },
  { calls: 2, key: 'earn_rewards', endpoint: 'GET /sapi/v1/simple-earn/flexible/history/rewardsRecord', weight: 150, max_window_days: 30, lookback_days: null, fanout: 'flexible 与 locked 分开两次' },
  { calls: 1, key: 'margin_interest', endpoint: 'GET /sapi/v1/margin/interestHistory', weight: 1, max_window_days: 30, lookback_days: 90, fanout: null },
  { calls: 1, key: 'convert', endpoint: 'GET /sapi/v1/convert/tradeFlow', weight: 3000, max_window_days: 30, lookback_days: null, fanout: '起止时间都必填' },
  { calls: 1, key: 'dust', endpoint: 'GET /sapi/v1/asset/dribblet', weight: 1, max_window_days: null, lookback_days: null, fanout: null },
]

export const LEDGER_SOURCE_KEYS = LEDGER_WINDOWS.map((row) => row.key)

/** 单次可查的上限 = 各来源上限里最小的那个 */
const TIGHTEST = LEDGER_WINDOWS
  .filter((row) => row.max_window_days !== null)
  .reduce((best, row) => (row.max_window_days! < best.max_window_days! ? row : best))

export const MAX_WINDOW_DAYS = TIGHTEST.max_window_days as number
export const LIMITED_BY = TIGHTEST.key

export function buildLedgerSnapshot(asOf: Date, days: number): LedgerSnapshot {
  const at = asOf.toISOString()
  const from = new Date(asOf.getTime() - days * MS_DAY).toISOString()
  const all = buildLedgerEntries(asOf)
  return {
    as_of: at,
    sources: LEDGER_SOURCE_KEYS.map((key): SourceState => ({
      key, status: 'ok', as_of: at, detail: null,
    })),
    windows: LEDGER_WINDOWS,
    window: { from, to: at, days, max_days: MAX_WINDOW_DAYS, limited_by: LIMITED_BY },
    entries: all.filter((entry) => entry.time >= from),
  }
}

/** 换算成 USD 的合计，给摘要与分类汇总用 */
export function sumUsd(entries: LedgerEntry[]) {
  return entries.reduce((sum, entry) => sum + (entry.value_usd ?? 0), 0)
}
