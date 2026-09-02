import type { ReactNode } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { cn } from '../lib/cn'
import { percent } from '../lib/format'
import { useIsAdmin } from '../lib/role'


/**
 * 模块。整页由不同列宽的模块拼合而成，而不是一列一节地堆叠——
 * 单列堆叠下每一节都得横跨整幅版心，窄内容于是被拉出上千像素的空档，
 * 或者被限宽后在右侧留一片空。模块按自己的天然宽度占列，并排铺满。
 */
export function Module({ title, figure, tone, note, span, onOpen, children }: {
  title: string
  figure?: string
  tone?: 'gain' | 'loss' | 'accent' | 'muted'
  note?: string
  /** 12 栏栅格里占几栏 */
  span: string
  onOpen?: () => void
  children: ReactNode
}) {
  // 标题旁那行小字讲的是口径——"钱在哪个钱包"、"越线才需要处理"、"已剔除充提"。
  // 成员看的是数字本身，这些既是噪音，也在讲系统内部是怎么算的。
  const isAdmin = useIsAdmin()
  const head = (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-2.5">
      <div className="flex items-baseline gap-2.5">
        <h3 className="section-title text-base">{title}</h3>
        {isAdmin && note && <span className="text-xs text-ink-3">{note}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        {figure && (
          <span className={cn('tnum text-base',
            tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss'
              : tone === 'accent' ? 'text-accent' : tone === 'muted' ? 'text-ink-3' : 'text-ink')}>
            {figure}
          </span>
        )}
        {onOpen && (
          <ArrowRight
            aria-hidden="true"
            className="translate-y-px text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent"
            size={12}
          />
        )}
      </div>
    </div>
  )

  return (
    <section className={cn('flex min-w-0 flex-col', span)}>
      {onOpen ? (
        <button className="group text-left" onClick={onOpen} type="button">{head}</button>
      ) : head}
      <div className="min-w-0 flex-1 pt-4">{children}</div>
    </section>
  )
}

export function Figure({ label, value, tone, note }: {
  label: string
  value: string
  tone?: 'gain' | 'loss'
  note?: string
}) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-2">
        <span className={cn('tnum text-lg', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-ink')}>
          {value}
        </span>
        {note && <span className="text-xs text-ink-3">{note}</span>}
      </dd>
    </div>
  )
}

/**
 * 两段占比条。数字在下面逐项列，条只回答一句"大头在哪边"——
 * 不给它配第三第四种颜色，多段色阶在这个尺寸上分不出来。
 */
export function SplitBar({ left, right, leftLabel, rightLabel, tone }: {
  left: number
  right: number
  leftLabel: string
  rightLabel: string
  tone?: 'pnl'
}) {
  const total = left + right
  if (!(total > 0)) return null
  return (
    <div className="mb-4">
      <span aria-hidden="true" className="flex h-[6px] gap-px overflow-hidden rounded-full">
        <span
          className={cn('block transition-[width] duration-500', tone === 'pnl' ? 'bg-gain/70' : 'bg-ink-3')}
          style={{ width: `${((left / total) * 100).toFixed(1)}%` }}
        />
        <span className={cn('block flex-1', tone === 'pnl' ? 'bg-loss/70' : 'bg-rule-strong')} />
      </span>
      <div className="mt-2 flex justify-between text-micro text-ink-3">
        <span>{leftLabel} {percent(left / total, 0)}</span>
        <span>{rightLabel} {percent(right / total, 0)}</span>
      </div>
    </div>
  )
}

/**
 * 四个视图共用的 12 栏栅格。每个视图两行、四个模块：
 * 一个天生宽的主模块占 7–8 栏，右侧一栏纵向叠两个窄模块把高度补齐，
 * 剩下一个横向铺满的模块收尾。行内不留空档，行与行之间也不留。
 */
export function ViewGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-12 gap-y-9 lg:grid-cols-12">{children}</div>
}

/** 右侧窄栏：两个模块纵向叠起来，去凑左边那个高模块的高度 */
export function Stack({ span, children }: { span: string; children: ReactNode }) {
  return <div className={cn('flex flex-col gap-9', span)}>{children}</div>
}
