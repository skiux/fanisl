import { memo, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import type { Freshness } from '../lib/format'

/**
 * 呼吸动效只给 live 状态。动效在这里承担语义——数据活着它才动，
 * 陈旧就静止。资产界面不该有纯装饰的永续动画。
 */
export const StatusDot = memo(function StatusDot({
  level, className,
}: { level: Freshness | 'error'; className?: string }) {
  const tone =
    level === 'live' ? 'bg-gain'
    : level === 'aging' ? 'bg-accent'
    : level === 'error' ? 'bg-loss'
    : 'bg-fg-3'
  return (
    <span className={cn('relative inline-flex size-[7px] shrink-0', className)}>
      {level === 'live' && (
        <span className="absolute inset-0 animate-ping rounded-full bg-gain opacity-60 [animation-duration:2.4s]" />
      )}
      <span className={cn('relative size-[7px] rounded-full', tone)} />
    </span>
  )
})

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-[10px] font-medium uppercase tracking-[0.16em] text-fg-3', className)}>
      {children}
    </span>
  )
}

export function SectionHead({
  label, title, aside,
}: { label: string; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>{label}</Eyebrow>
        <h2 className="text-[15px] font-medium tracking-tight text-fg">{title}</h2>
      </div>
      {aside}
    </div>
  )
}

/** 盈亏方向由符号和颜色共同表达，色盲用户只看符号也能读 */
export function Delta({
  value, children, className,
}: { value: number | null; children: ReactNode; className?: string }) {
  const tone =
    value === null ? 'text-fg-3'
    : value > 0 ? 'text-gain'
    : value < 0 ? 'text-loss'
    : 'text-fg-2'
  return <span className={cn('tnum', tone, className)}>{children}</span>
}

export function Divider() {
  return <div className="h-px w-full bg-line" />
}
