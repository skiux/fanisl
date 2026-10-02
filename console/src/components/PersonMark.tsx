import type { CSSProperties } from 'react'
import { cn } from '../lib/cn'
import { tickerHue } from './Ticker'

/**
 * 一个人的标记：显示名的第一个字，圆形。颜色按用户名哈希，取标的字母标记那一段
 * 色相（蓝→紫，避开盈亏的绿红与强调色），同一个人在「用户」页的列表、分配条和
 * 资产页的「账户」里永远是同一个颜色。
 */
export function PersonMark({ name, username, size = 'md' }: {
  name: string
  username: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('ticker grid shrink-0 place-items-center rounded-full font-medium',
        size === 'sm' ? 'size-6 text-[11px]' : size === 'lg' ? 'size-10 text-base' : 'size-8 text-[13px]')}
      style={{ '--ticker-hue': tickerHue(username) } as CSSProperties}
    >
      {Array.from(name.trim() || username)[0]?.toUpperCase()}
    </span>
  )
}

/** 分配条里这个人那一段的颜色，与标记同一个色相 */
export function personColor(username: string) {
  return `oklch(var(--person-tone) 0.12 ${tickerHue(username)})`
}
