import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { Dialog } from 'radix-ui'
import { segmentClass } from './controls'
import { cn } from '../lib/cn'

/**
 * 起止日期选择器：上面两个日期，下面两列滚轮（左边年月、右边日）。
 *
 * 上一版让人**在日历上点两下**选起止。三个问题：要先读一句"点一天作为起点"才知道
 * 怎么用；选完之后没有再进入选取态的入口；而它挂在 `SegmentedControl` 的
 * 「自定义」项上，Radix 单选组点已选中项不触发 `onValueChange`，于是选过一次
 * 就再也打不开。现在它是一个独立按钮，按钮上直接写着选中的区间。
 *
 * 手机上是底部面板，桌面居中；打开后先改草稿，只有「完成」才提交。
 * 滚轮保留 iOS 的滚筒结构：中间一项正对，上下逐渐变小变淡并向后倾倒。
 * 吸附与惯性交给 `scroll-snap`，倾倒交给滚动驱动的关键帧；每一项同时是按钮，
 * 保证鼠标、触屏和键盘都能操作。
 */
const ITEM = 44
const VISIBLE = 5

const MS_DAY = 86_400_000

const iso = (at: Date) => at.toISOString().slice(0, 10)
const monthOf = (day: string) => day.slice(0, 7)
const daysIn = (month: string) =>
  new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate()
const displayDate = (day: string) =>
  `${day.slice(0, 4)}年${+day.slice(5, 7)}月${+day.slice(8, 10)}日`

function clamp(day: string, first: string, last: string) {
  return day < first ? first : day > last ? last : day
}

export function RangePicker({ first, last, value, active, onChange }: {
  /** 有数据的第一天 / 最后一天，选不出范围之外的日子 */
  first: string
  last: string
  value: { from: string; to: string } | null
  active: boolean
  onChange: (range: { from: string; to: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ from: first, to: last })
  const [edit, setEdit] = useState<'from' | 'to'>('from')

  // 默认：右边是最后一天（"现在"），左边往前推一个月
  const fallback = {
    from: clamp(iso(new Date(Date.parse(`${last}T00:00:00Z`) - 29 * MS_DAY)), first, last),
    to: last,
  }

  const start = () => {
    setDraft(value ?? fallback)
    setEdit('from')
    setOpen(true)
  }

  const months: string[] = []
  for (let at = monthOf(first); at <= monthOf(last);) {
    months.push(at)
    const next = new Date(Date.UTC(+at.slice(0, 4), +at.slice(5, 7), 1))
    at = iso(next).slice(0, 7)
  }

  const current = draft[edit]
  const month = monthOf(current)
  // 这个月里能选的日子：不能超出有数据的范围
  const days: string[] = []
  for (let d = 1; d <= daysIn(month); d += 1) {
    const day = `${month}-${String(d).padStart(2, '0')}`
    if (day >= first && day <= last) days.push(day)
  }

  const set = (day: string) => setDraft((it) => {
    if (edit === 'from') return { from: day, to: day > it.to ? day : it.to }
    return { from: day < it.from ? day : it.from, to: day }
  })

  const commit = () => {
    const { from, to } = draft
    onChange(from <= to ? { from, to } : { from: to, to: from })
    setOpen(false)
  }

  return (
    <Dialog.Root onOpenChange={(next) => { if (next) start(); else setOpen(false) }} open={open}>
      <Dialog.Trigger className={segmentClass('sm', active)}>
        {value ? `${value.from} — ${value.to}` : '自定义'}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="range-picker-overlay fixed inset-0 z-40 bg-ink/15 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'range-picker-dialog fixed inset-x-0 bottom-0 z-50 bg-sheet px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2',
            'rounded-t-[22px] border-t border-rule shadow-[var(--sheet-shadow)] outline-none',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[22rem] sm:-translate-x-1/2 sm:-translate-y-1/2',
            'sm:rounded-[18px] sm:border sm:p-5',
          )}
        >
          <div aria-hidden="true" className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-rule-strong sm:hidden" />
          <header className="grid grid-cols-[4rem_1fr_4rem] items-center">
            <button
              className="justify-self-start px-1 py-2 text-sm text-ink-3 outline-none transition-colors duration-200 hover:text-ink active:opacity-60"
              onClick={() => setOpen(false)}
              type="button"
            >
              取消
            </button>
            <Dialog.Title className="text-center text-sm font-medium text-ink">自定义区间</Dialog.Title>
            <button
              className="justify-self-end px-1 py-2 text-sm font-medium text-accent outline-none transition-opacity duration-200 active:opacity-60"
              onClick={commit}
              type="button"
            >
              完成
            </button>
          </header>

          {/* 开始与结束各是一个明确的编辑目标，关闭或取消不会写入半成品。 */}
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {(['from', 'to'] as const).map((which) => (
              <span className="contents" key={which}>
                {which === 'to' && <CaretRight aria-hidden="true" className="text-ink-3" size={13} />}
                <button
                  aria-pressed={edit === which}
                  className={cn(
                    'grid min-w-0 gap-0.5 rounded-[12px] border px-3 py-2.5 text-left outline-none',
                    'transition-[background-color,border-color,transform] duration-200 active:scale-[0.98]',
                    edit === which
                      ? 'border-rule-strong bg-sheet-2 text-ink'
                      : 'border-rule bg-transparent text-ink-2 hover:bg-sheet-2/55',
                  )}
                  onClick={() => setEdit(which)}
                  type="button"
                >
                  <span className="text-micro text-ink-3">{which === 'from' ? '开始' : '结束'}</span>
                  <span className="tnum truncate text-xs">{displayDate(draft[which])}</span>
                </button>
              </span>
            ))}
          </div>

          <div className="relative mt-3 grid grid-cols-[1.45fr_1fr] overflow-hidden rounded-[14px]">
            {/* 选中条横跨两列，不是每列一条——iOS 的 UIDatePicker 就是一条。
                放在网格上而不是各自的 Wheel 里，中间那条缝才不会把它切断。 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[10px] border-y border-rule bg-sheet-2/80 shadow-[inset_0_1px_0_var(--rule)]"
              style={{ height: ITEM }}
            />
            <Wheel
              items={months.map((m) => ({
                value: m, label: `${m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月`,
              }))}
              label="年月"
              onChange={(next) => {
                // 换月时保住"第几号"，那个月没有这天就退到最近的一天
                const wanted = `${next}-${current.slice(8, 10)}`
                const total = daysIn(next)
                const day = +current.slice(8, 10) > total
                  ? `${next}-${String(total).padStart(2, '0')}` : wanted
                set(clamp(day, first, last))
              }}
              value={month}
            />
            <Wheel
              items={days.map((d) => ({ value: d, label: String(+d.slice(8, 10)) }))}
              label="日"
              onChange={set}
              value={current}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Wheel({ items, value, onChange, label }: {
  items: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const unlock = useRef<number | undefined>(undefined)
  /** 正在由程序滚动：这期间读位置读到的是动画中途的值 */
  const driving = useRef(false)
  const index = Math.max(0, items.findIndex((item) => item.value === value))

  /**
   * 滚到某一格。
   *
   * **一定要有解锁兜底。** 不是所有环境都做平滑滚动（本项目的预览面板整个关掉了，
   * 连页面主滚动容器都不动），那时 `scrollTo` 不产生任何滚动，`scrollend` 永远不来。
   * 只靠事件解锁的话 `driving` 永久为真，之后用户自己滚也回读不出值。
   *
   * 曾经以为是"吸附取消了平滑滚动"，还为此退回瞬时跳并把 `scroll-snap` 临时摘掉——
   * 摘掉之后同样因为事件不来而再也装不回去，吸附直接没了。两个都是误诊的代价。
   */
  const glide = (top: number, smooth: boolean) => {
    const el = ref.current
    if (!el) return
    driving.current = true
    window.clearTimeout(unlock.current)
    unlock.current = window.setTimeout(() => {
      driving.current = false
      // 平滑滚动没生效的环境里位置还停在原处：直接就位，
      // 别让滚轮显示的格子和上面的日期对不上
      const now = ref.current
      if (now && Math.abs(now.scrollTop - top) > 2) now.scrollTop = top
    }, 600)
    el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  }

  /** 滚停了：把停在哪一格回写成值 */
  const settle = () => {
    const el = ref.current
    if (!el) return
    if (driving.current) { driving.current = false; return }
    const hit = items[Math.min(items.length - 1,
                               Math.max(0, Math.round(el.scrollTop / ITEM)))]
    if (hit && hit.value !== value) onChange(hit.value)
  }

  // 事件回调要拿到最新的 `value` / `items`，而监听只挂一次——用 ref 转一道
  const latest = useRef(settle)
  latest.current = settle

  // `scrollend` 在滚动**与吸附都结束**的那一刻触发，比定时器准也比定时器快；
  // 上一版等 120ms 再回读，手感上就是那一下迟滞。不支持的浏览器走兜底定时器。
  const hasScrollEnd = typeof window !== 'undefined' && 'onscrollend' in window
  useEffect(() => {
    const el = ref.current
    if (!el || !hasScrollEnd) return
    const fn = () => latest.current()
    el.addEventListener('scrollend', fn)
    return () => el.removeEventListener('scrollend', fn)
  }, [hasScrollEnd])

  useEffect(() => () => {
    window.clearTimeout(timer.current)
    window.clearTimeout(unlock.current)
  }, [])

  // 上下各留两格空白，第一项与最后一项才能停在中间。
  // 于是"第 i 项居中"恰好等于 scrollTop = i × 行高，取值与回填都只有这一条算式。
  //
  // **必须在布局阶段对齐。** Dialog 是打开那一刻才挂载的，用 `useEffect` 的话
  // 首帧容器还没布局，滚动请求落空——打开看到的是停在 0 的滚轮。
  // 首次（打开那一下）直接就位，之后换值才滑过去。
  const opened = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const top = index * ITEM
    if (Math.abs(el.scrollTop - top) < 2) { opened.current = true; return }
    glide(top, opened.current)
    opened.current = true
  }, [index])

  return (
    <div style={{ height: VISIBLE * ITEM }}>
      {/* `relative` 不能少：选中条是绝对定位的，定位元素会盖在普通流内容之上，
          不给滚动容器也定位的话，那块底会把正中间一项的文字整个遮住。 */}
      <div
        aria-label={label}
        className="wheel relative h-full"
        onKeyDown={(event) => {
          const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
          const target = event.key === 'Home' ? 0
            : event.key === 'End' ? items.length - 1 : index + delta
          if (delta === 0 && event.key !== 'Home' && event.key !== 'End') return
          event.preventDefault()
          const next = items[Math.min(items.length - 1, Math.max(0, target))]
          if (next) onChange(next.value)
        }}
        onPointerDown={() => {
          driving.current = false
          window.clearTimeout(unlock.current)
        }}
        onScroll={() => {
          if (hasScrollEnd) return
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => latest.current(), 140)
        }}
        onWheel={() => {
          driving.current = false
          window.clearTimeout(unlock.current)
        }}
        ref={ref}
      >
        <div className="wheel-track" style={{ paddingBlock: ((VISIBLE - 1) / 2) * ITEM }}>
          {items.map((item) => (
            <button
              // 鼠标上滚轮不好用，每一项同时是按钮
              className="wheel-item tnum"
              data-on={item.value === value}
              key={item.value}
              onClick={() => onChange(item.value)}
              tabIndex={item.value === value ? 0 : -1}
              style={{ height: ITEM }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
