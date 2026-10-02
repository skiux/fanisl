import type { ReactNode } from 'react'
import { X } from '@phosphor-icons/react'
import { Dialog } from 'radix-ui'
import { cn } from '../lib/cn'

/**
 * 一张浮起的纸：窄屏从底部升起（拇指够得着），宽屏居中。与「今日盈亏」的明细
 * 同一个样子，进出用日期选择那套动效（`index.css` 的 `.sheet-panel`）。
 *
 * 用户页的编辑都在这里做：页面上只放读数，改什么点开改。
 */
export function Sheet({ title, subtitle, leading, onClose, children, width = '32rem' }: {
  title: string
  subtitle?: ReactNode
  /** 标题左边的标记（头像之类） */
  leading?: ReactNode
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  return (
    <Dialog.Root onOpenChange={(open) => { if (!open) onClose() }} open>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'sheet-panel fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto outline-none',
            'rounded-t-[18px] border-t border-rule bg-sheet px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5',
            'shadow-[var(--sheet-shadow)]',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(var(--sheet-w),92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2',
            'sm:rounded-[3px] sm:border sm:px-8 sm:pb-8 sm:pt-7',
          )}
          style={{ ['--sheet-w' as string]: width }}
        >
          <header className="mb-6 flex items-start gap-3">
            {leading}
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate font-display text-lg leading-tight text-ink">{title}</Dialog.Title>
              {subtitle && <div className="mt-1 truncate text-xs text-ink-3">{subtitle}</div>}
            </div>
            <Dialog.Close
              aria-label="关闭"
              className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-ink-3 transition-colors duration-200 hover:bg-sheet-2 hover:text-ink"
            >
              <X aria-hidden="true" size={14} />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
