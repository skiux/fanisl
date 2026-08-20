import type { ReactNode } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'

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
  const head = (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-2.5">
      <div className="flex items-baseline gap-2.5">
        <h3 className="section-title text-base">{title}</h3>
        {note && <span className="text-xs text-ink-3">{note}</span>}
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
