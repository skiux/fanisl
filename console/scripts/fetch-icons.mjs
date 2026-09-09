// 把标的图标下载进仓库：`node scripts/fetch-icons.mjs`
//
// 不在运行时引图床——那会让每次打开页面都把"这个账户持有哪些币"告诉第三方。
// 下载下来的文件进 public/icons/，同时生成 src/components/icons.ts 那份清单，
// 组件据此决定用真图标还是字母标记（清单避免了 404 之后再回退的闪烁）。
//
// 两个来源都是 CC0：
//   加密货币  spothq/cryptocurrency-icons —— 32×32 自带圆底，可以直接用
//   品牌      simpleicons.org —— 24×24 单色路径，这里包一层品牌色圆底，
//             好跟上面那套长得一样
import { writeFile, readdir, rm } from 'node:fs/promises'

const CRYPTO = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'LTC', 'TRX',
  'UNI', 'ATOM', 'LINK', 'MATIC', 'AVAX', 'BCH', 'XLM', 'ETC', 'FIL', 'ICP',
  'VET', 'ALGO', 'AAVE', 'CRV', 'MKR', 'SAND', 'MANA', 'GRT', 'PAXG',
  'USDT', 'USDC',
]

// Binance 的美股永续。代码 → simpleicons 的 slug
const BRANDS = {
  NVDA: 'nvidia', MSTR: 'microstrategy', TSLA: 'tesla', AAPL: 'apple',
  MSFT: 'microsoft', GOOGL: 'google', AMZN: 'amazon', META: 'meta',
  COIN: 'coinbase', NFLX: 'netflix', AMD: 'amd', INTC: 'intel',
  PLTR: 'palantir', UBER: 'uber', PYPL: 'paypal',
}

const CRYPTO_URL = (a) =>
  `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${a.toLowerCase()}.svg`
const BRAND_URL = (slug) => `https://cdn.simpleicons.org/${slug}`

async function get(url) {
  const res = await fetch(url)
  return res.ok ? res.text() : null
}

/** 单色路径 → 品牌色圆底 + 白色图形，和加密那套的形状对齐 */
function badge(svg) {
  const hex = svg.match(/fill="(#[0-9a-fA-F]{3,8})"/)?.[1]
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1])
  if (!hex || paths.length === 0) return null
  // 24×24 的图形缩到 19px 摆进 32×32 的圆里
  const inner = paths.map((d) => `<path d="${d}"/>`).join('')
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    + `<circle cx="16" cy="16" r="16" fill="${hex}"/>`
    + `<g fill="#fff" transform="translate(6.5 6.5) scale(0.7917)">${inner}</g>`
    + '</svg>'
}

const dir = new URL('../public/icons/', import.meta.url)
for (const name of await readdir(dir).catch(() => [])) {
  await rm(new URL(name, dir))
}

const done = []
for (const asset of CRYPTO) {
  const svg = await get(CRYPTO_URL(asset))
  if (!svg) { console.log(`miss ${asset}`); continue }
  await writeFile(new URL(`${asset}.svg`, dir), svg)
  done.push(asset)
}
for (const [asset, slug] of Object.entries(BRANDS)) {
  const svg = await get(BRAND_URL(slug))
  const wrapped = svg && badge(svg)
  if (!wrapped) { console.log(`miss ${asset}`); continue }
  await writeFile(new URL(`${asset}.svg`, dir), wrapped)
  done.push(asset)
}

await writeFile(new URL('../src/components/icons.ts', import.meta.url),
  `// 由 scripts/fetch-icons.mjs 生成，别手改。图标在 public/icons/。\n`
  + `// 不在这份清单里的标的用字母标记（见 components/Ticker.tsx）。\n`
  + `export const BUNDLED_ICONS = new Set([\n`
  + done.sort().map((a) => `  '${a}',`).join('\n')
  + `\n])\n`)

console.log(`${done.length} icons`)
