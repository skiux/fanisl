/** 报价表。现货估值、合约标记价、委托的名义价值共用一份，避免几处各写一遍对不上。 */
export const PRICE: Record<string, number | null> = {
  USDT: 1.0002, BTC: 94180.22, ETH: 3142.68, SOL: 187.44, BNB: 682.15,
  LINK: 21.77, ARB: 0.7431, SHIB: 0.00001842, XRP: 2.5813, DOGE: 0.3394,
  ADA: 0.6502, AVAX: 34.92, LTC: 103.47, ATOM: 4.4612, DOT: 3.8871,
  FIL: 3.5104, NEAR: 4.6238, ALGO: 0.2261, VET: 0.02784, TRX: 0.2617,
  LUNC: 0.00000091, BETH: null, PAXG: null,
}

/** USDT 计价的交易对拆回基础币，BTCUSDT → BTC */
export function baseOf(symbol: string) {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol
}

export function priceOf(symbol: string) {
  return PRICE[baseOf(symbol)] ?? null
}
