import type { CSSProperties } from 'react'
import { cn } from '../lib/cn'
import { ICONS } from './icons'

/**
 * 标的的识别标记：**图标下载进仓库，没有的用字母标记兜底。**
 *
 * 图标在 `public/icons/`，由 `scripts/fetch-icons.mjs` 抓下来（股票与 ETF 走
 * parqet 的品牌方图，加密货币走 spothq 的圆图，个别新股用 FMP 的 PNG 兜底，
 * 贵金属用 TradingView）。哪些有图靠 `icons.ts` 那份**生成的清单**判断，
 * 不是先请求再看 404——那样每个没有图标的标的都要闪一下才回退。
 *
 * **不在运行时引图床。** 那会让每开一次页面，第三方就收到一份"这个账户持有哪些币"
 * 的请求。一个私人资产台不该为了几个图标做这件事。下载下来还顺带解决了离线与缓存。
 *
 * 清单覆盖不到的（SHIB / LUNC 这种图标源里确实没有的）走**带颜色的字母标记**：颜色由代码哈希，同一个标的永远同一个色，扫一列的时候眼睛能锁住行
 * ——那正是 logo 在这里的作用。要加新的就往 `fetch-icons.mjs` 的名单里补一行再跑。
 *
 * **字母标记的色相避开 gain / loss / accent 三个已被占用的**（绿 ≈155°、红 ≈30°、
 * 黄铜 ≈85°）——这套界面里绿红只表示盈亏，一个偏绿的标记会被读成"涨了"。
 * 留下的是 195–320 那一段蓝→靛→紫。真图标不受这条约束：它是品牌自己的颜色，
 * 形状也认得出来，不会被当成涨跌。
 */
const HUES = [195, 220, 245, 270, 295, 320]

function hueOf(asset: string) {
  let hash = 0
  for (let i = 0; i < asset.length; i += 1) hash = (hash * 31 + asset.charCodeAt(i)) % 9973
  return HUES[hash % HUES.length]
}

/** 字母标记的色相。真图标不走这里 */
export function tickerHue(asset: string) {
  return hueOf(asset)
}

export function Ticker({ asset, size = 'md' }: { asset: string; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-5' : 'size-7'
  const file = ICONS[asset]
  if (file) {
    return (
      <img
        alt=""
        // **统一裁成圆的**：股票那批是 60×60 的品牌色方图，加密那批是 32×32 圆图，
        // 混在一列里方一个圆一个很扎眼。垫一层 sheet-2 是给透明底的 PNG 用的，
        // 不垫的话那几个会显得没有圆盘、浮在纸上。
        className={cn('shrink-0 rounded-full bg-sheet-2 object-cover', box)}
        src={`${import.meta.env.BASE_URL}icons/${file}`}
      />
    )
  }
  // 四个字母才写得下 DOGE / NVDA / MSTR。截成三位的话 NVDA 变成 NVD，
  // 而这一列的作用恰恰是"一眼认出是哪个"
  const label = asset.slice(0, 4)
  return (
    <span
      aria-hidden="true"
      className={cn('ticker grid shrink-0 place-items-center font-mono font-medium tracking-tight',
        size === 'sm' ? 'size-5 rounded-[5px]' : 'size-7 rounded-[6px]',
        label.length > 3
          ? (size === 'sm' ? 'text-[7px]' : 'text-[8.5px]')
          : (size === 'sm' ? 'text-[8.5px]' : 'text-[10px]'))}
      style={{ '--ticker-hue': hueOf(asset) } as CSSProperties}
    >
      {label}
    </span>
  )
}
