// 把标的图标下载进仓库：`node scripts/fetch-icons.mjs`
//
// 不在运行时引图床——那会让每次打开页面都把"这个账户持有哪些币"告诉第三方。
// 下载下来的文件进 public/icons/，同时生成 src/components/icons.ts 那份清单，
// 组件据此决定用真图标还是字母标记（清单避免了 404 之后再回退的闪烁）。
//
// 三个来源，按顺序试，先成的算：
//   parqet    按代码给 60×60 方图，底色是品牌色。**股票与 ETF 的主力**
//   spothq    cryptocurrency-icons，32×32 圆图。加密货币用它，比 parqet 全
//   fmp       PNG 兜底，只有前两个都没有时才用（CRCL / SKHY 这种新上市的）
//   tv        TradingView 的符号图，用来补贵金属
//
// 方图与圆图混着无所谓：组件统一裁成圆的，底下再垫一层 sheet-2，
// 透明底的 PNG 也就有了同样的圆盘。
import { writeFile, readdir, rm } from 'node:fs/promises'

const CRYPTO = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'LTC', 'TRX',
  'UNI', 'ATOM', 'LINK', 'MATIC', 'AVAX', 'BCH', 'XLM', 'ETC', 'FIL', 'ICP',
  'VET', 'ALGO', 'AAVE', 'CRV', 'MKR', 'SAND', 'MANA', 'GRT', 'PAXG', 'ARB',
  'USDT', 'USDC',
]

// 美股永续与 ETF。Binance 上过的 + 用户关注列表里的
const STOCKS = [
  'SPY', 'QQQ', 'IWM', 'DIA',
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
  'AVGO', 'AMD', 'INTC', 'MU', 'ARM', 'TSM', 'MRVL', 'SNDK', 'LITE', 'GLW',
  'ORCL', 'CRM', 'ADBE', 'NFLX', 'PYPL', 'UBER', 'COIN', 'HOOD', 'PLTR',
  'SNOW', 'SHOP', 'MSTR', 'COST', 'LLY', 'JPM', 'V', 'MA', 'BAC', 'WMT',
  'XOM', 'UNH', 'JNJ', 'PG', 'HD', 'DIS', 'BA', 'CAT', 'KO', 'PEP', 'MCD',
  'NKE', 'SBUX', 'CRWD', 'SMCI', 'BABA', 'NBIS', 'IONQ', 'RKLB',
  'CRCL', 'SKHY',
]

const AT = {
  parqet: (t) => `https://assets.parqet.com/logos/symbol/${t}`,
  spothq: (a) =>
    `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${a.toLowerCase()}.svg`,
  fmp: (t) => `https://financialmodelingprep.com/image-stock/${t}.png`,
  tv: (slug) => `https://s3-symbol-logo.tradingview.com/${slug}.svg`,
}

const WANTED = [
  ...CRYPTO.map((a) => ({ code: a, tries: [AT.spothq(a), AT.parqet(a)] })),
  ...STOCKS.map((t) => ({ code: t, tries: [AT.parqet(t), AT.fmp(t)] })),
  // 贵金属：XAUUSDT / XAGUSDT 的 baseOf 是 XAU / XAG
  { code: 'XAU', tries: [AT.parqet('GOLD'), AT.tv('gold')] },
  { code: 'XAG', tries: [AT.tv('silver')] },
]

const dir = new URL('../public/icons/', import.meta.url)
for (const name of await readdir(dir).catch(() => [])) await rm(new URL(name, dir))

const found = {}
for (const { code, tries } of WANTED) {
  for (const url of tries) {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) continue
    const type = res.headers.get('content-type') ?? ''
    const ext = type.includes('svg') ? 'svg' : type.includes('png') ? 'png' : null
    if (!ext) continue
    await writeFile(new URL(`${code}.${ext}`, dir), Buffer.from(await res.arrayBuffer()))
    found[code] = `${code}.${ext}`
    break
  }
  if (!found[code]) console.log(`miss ${code}`)
}

const rows = Object.keys(found).sort().map((c) => `  ${c}: '${found[c]}',`).join('\n')
await writeFile(new URL('../src/components/icons.ts', import.meta.url),
  '// 由 scripts/fetch-icons.mjs 生成，别手改。图标在 public/icons/。\n'
  + '// 不在这份清单里的标的用字母标记（见 components/Ticker.tsx）。\n'
  + `export const ICONS: Record<string, string> = {\n${rows}\n}\n`)

console.log(`${Object.keys(found).length} icons`)
