import type { CSSProperties } from 'react'
import { cn } from '../lib/cn'

/**
 * 标的的识别标记。
 *
 * **不用真的 logo，是两条硬理由，不是省事：**
 *
 * 1. **覆盖不全。** 这个账户的仓位大半是美股永续（NVDA / QQQ / MSTR / XAU），
 *    加密货币图标源（coincap / cryptocurrency-icons 之流）里根本没有它们，
 *    而 Binance 自己的图标 CDN 路径是不可推导的哈希。最后必然是"一半有图、
 *    一半是占位符"，那比统一的字母标记更乱。
 * 2. **远程图标会把持仓泄露出去。** 每开一次页面，第三方图床就收到一份
 *    "这个账户持有哪些币"的请求。一个私人资产台不该为了几个图标做这件事。
 *
 * 所以这里是**带颜色的字母标记**：颜色由代码哈希出来，同一个标的永远同一个色，
 * 扫一列的时候眼睛能锁住行。真要品牌图形的话，正确做法是把用到的那几个 SVG
 * 打进包里（离线、可控），而不是引一个图床。
 *
 * **色相避开 gain / loss / accent 三个已被占用的**（绿 ≈155°、红 ≈30°、
 * 黄铜 ≈85°）——这套界面里绿红只表示盈亏，一个偏绿的标记会被读成"涨了"。
 * 留下的是 195–320 那一段蓝→靛→紫。
 */
const HUES = [195, 220, 245, 270, 295, 320]

function hueOf(asset: string) {
  let hash = 0
  for (let i = 0; i < asset.length; i += 1) hash = (hash * 31 + asset.charCodeAt(i)) % 9973
  return HUES[hash % HUES.length]
}

export function Ticker({ asset, size = 'md' }: { asset: string; size?: 'sm' | 'md' }) {
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
