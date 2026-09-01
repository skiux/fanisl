import { baseOf } from '../lib/format'

/**
 * 报价表。现货估值、合约标记价、委托的名义价值共用一份，避免几处各写一遍对不上。
 *
 * 这个账户的标的以美股 / 指数 ETF / 金属为主，走的是 Binance U 本位永续
 * （NVDAUSDT、QQQUSDT、XAUUSDT…，与 backend instruments.py 的 exec_symbol 一致）。
 * 现货只留 USDT（保证金）与 BNB（手续费抵扣），外加几笔历史残留的小额。
 */
export const PRICE: Record<string, number | null> = {
  // 计价与手续费
  USDT: 1.0002, BNB: 682.15,
  // 账户不持有 BTC，但 /sapi/v1/asset/wallet/balance 原生就是 BTC 计价，换算要用
  BTC: 94180.22,
  // 永续标的：美股
  NVDA: 218.42, MSTR: 342.16, QQQ: 618.74, AAPL: 274.83, MSFT: 612.35,
  AMZN: 268.91, COIN: 415.62, CRCL: 182.34, MU: 196.75, TSLA: 351.08,
  SPY: 702.16,
  // 永续标的：金属与原油
  XAU: 4180.52, XAG: 51.83, CL: 63.47,
  // 历史残留的小额币，留着是为了让"灰尘"与"无报价"两条路径有真实数据走
  ETH: 3142.68, SOL: 187.44, ARB: 0.7431, DOGE: 0.3394, SHIB: 0.00001842,
  LUNC: 0.00000091, BETH: null, PAXG: null,
}

export { baseOf }

export function priceOf(symbol: string) {
  return PRICE[baseOf(symbol)] ?? null
}
