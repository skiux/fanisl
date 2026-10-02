import { useState } from 'react'
import { CalendarBlank } from '@phosphor-icons/react'
import { Dialog } from 'radix-ui'
import { cn } from '../lib/cn'
import {
  daysIn, displayDate, iso, ITEM, monthOf, shiftYear, Wheel,
} from './RangePicker'

/**
 * 选一天。与日历的「自定义区间」同一套：手机上从底部升起，桌面居中一张小纸，
 * 两列滚轮（左边年月、右边日），先改草稿，「完成」才提交。
 *
 * **不用原生 `<input type="date">`。** 用户页第一版用了它，弹出来的是系统画的日历——
 * 蓝色选中块、系统字体、"清除 / 今天"，和这套纸面完全不是一个东西，2026-10-03 被指出。
 * 这条在 README「原生表单控件顶不住的地方就别硬用」里早就写过。
 */
export function DatePicker({ id, value, onChange, label, min, max, disabled = false }: {
  id?: string
  value: string | null
  onChange: (day: string) => void
  /** 屏幕阅读器读的名字，也是弹层的标题 */
  label: string
  min: string
  max: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? iso(new Date()))

  const months: string[] = []
  for (let at = monthOf(min); at <= monthOf(max);) {
    months.push(at)
    at = iso(new Date(Date.UTC(+at.slice(0, 4), +at.slice(5, 7), 1))).slice(0, 7)
  }
  const month = monthOf(draft)
  const days = Array.from({ length: daysIn(month) },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
  const set = (day: string) => {
    if (day < min || day > max) return false
    setDraft(day)
    return true
  }

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (next) setDraft(value ?? clampDay(iso(new Date()), min, max))
        setOpen(next)
      }}
      open={open}
    >
      <Dialog.Trigger
        className={cn(
          'tnum flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[7px] border border-rule-strong',
          'bg-sheet px-3 text-left text-sm outline-none transition-[border-color,box-shadow] duration-200',
          'hover:border-ink-3 focus-visible:border-ink focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]',
          'disabled:cursor-default disabled:opacity-50',
          value ? 'text-ink' : 'text-ink-3',
        )}
        disabled={disabled}
        id={id}
      >
        <span className="truncate">{value ? displayDate(value) : '—'}</span>
        <CalendarBlank aria-hidden="true" className="shrink-0 text-ink-3" size={14} />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="range-picker-overlay fixed inset-0 z-[60] bg-ink/15 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'range-picker-dialog fixed inset-x-0 bottom-0 z-[60] bg-sheet px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2',
            'rounded-t-[22px] border-t border-rule shadow-[var(--sheet-shadow)] outline-none',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[20rem] sm:-translate-x-1/2 sm:-translate-y-1/2',
            'sm:rounded-[18px] sm:border sm:p-5',
          )}
        >
          <div aria-hidden="true" className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-rule-strong sm:hidden" />
          <header className="flex items-center justify-between">
            <Dialog.Close className="px-1 py-2 text-sm text-ink-3 outline-none transition-colors duration-200 hover:text-ink active:opacity-60">
              取消
            </Dialog.Close>
            <Dialog.Title className="text-sm text-ink">{label}</Dialog.Title>
            <button
              className="px-1 py-2 text-sm font-medium text-accent outline-none transition-opacity duration-200 active:opacity-60"
              onClick={() => { onChange(draft); setOpen(false) }}
              type="button"
            >
              完成
            </button>
          </header>

          <p className="tnum mt-3 text-center font-display text-lg text-ink">{displayDate(draft)}</p>

          <div className="relative mt-3 grid grid-cols-[1.45fr_1fr] overflow-hidden rounded-[14px]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[10px] border-y border-rule bg-sheet-2/80 shadow-[inset_0_1px_0_var(--rule)]"
              style={{ height: ITEM }}
            />
            <Wheel
              items={months.map((m) => ({ value: m, label: `${m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月` }))}
              label="年月"
              onChange={(next) => {
                // 保住日号；目标月份没有这一天（31 日翻到 2 月）就停在那个月的最后一天
                const day = Math.min(+draft.slice(8, 10), daysIn(next))
                return set(`${next}-${String(day).padStart(2, '0')}`)
              }}
              value={month}
            />
            <Wheel
              items={days.map((d) => ({ value: d, label: String(+d.slice(8, 10)) }))}
              label="日"
              loop
              onChange={set}
              value={draft}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function clampDay(day: string, min: string, max: string) {
  return day < min ? min : day > max ? max : day
}

/** 起止范围的常用写法：今天往前 n 年、往后 m 年 */
export function yearsAround(back: number, ahead: number, today = iso(new Date())) {
  return { min: shiftYear(today, -back), max: shiftYear(today, ahead) }
}
