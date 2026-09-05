import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
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
 * 滚轮是 iOS 那种**滚筒**：中间一项正对，上下的逐渐变小变淡、绕 X 轴向后倒，
 * 顶底渐隐。吸附与惯性交给 `scroll-snap`，倾倒交给滚动驱动的关键帧
 * （`animation-timeline: view()`，见 index.css 的 `.wheel`）——两样都是浏览器
 * 自己做，这里一行动画 JS 都没有。每一项同时是按钮：鼠标上滚轮不好用。
 */
const ITEM = 40
const VISIBLE = 5

const MS_DAY = 86_400_000

const iso = (at: Date) => at.toISOString().slice(0, 10)
const monthOf = (day: string) => day.slice(0, 7)
const daysIn = (month: string) =>
  new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate()

function clamp(day: string, first: string, last: string) {
  return day < first ? first : day > last ? last : day
}

export function RangePicker({ first, last, value, active, onChange, onOpen }: {
  /** 有数据的第一天 / 最后一天，选不出范围之外的日子 */
  first: string
  last: string
  value: { from: string; to: string } | null
  active: boolean
  onChange: (range: { from: string; to: string }) => void
  onOpen: () => void
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
    onOpen()
    // 头一次打开就把默认区间落下去。不落的话选择器里写着 08-07 — 09-05，
    // 而页面按"还没选，先用全窗口"算了 90 天，两个数当着面对不上。
    if (value === null) onChange(fallback)
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

  const set = (day: string) => setDraft((it) => ({ ...it, [edit]: day }))

  const commit = () => {
    const { from, to } = draft
    onChange(from <= to ? { from, to } : { from: to, to: from })
    setOpen(false)
  }

  return (
    <Popover.Root onOpenChange={(next) => { if (!next) commit(); else start() }} open={open}>
      <Popover.Trigger className={segmentClass('sm', active)}>
        {value ? `${value.from} — ${value.to}` : '自定义'}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          className={cn('z-50 w-[19rem] border border-rule bg-sheet p-4',
            'shadow-[var(--sheet-shadow)] rounded-[3px]')}
          collisionPadding={12}
          sideOffset={8}
        >
          {/* 上面两个日期：点哪个，下面的滚轮就改哪个 */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            {(['from', 'to'] as const).map((which) => (
              <button
                className={cn('tnum rounded-[3px] border px-2 py-1.5 text-xs transition-colors duration-200',
                  edit === which
                    ? 'border-accent text-ink'
                    : 'border-rule text-ink-3 hover:border-rule-strong hover:text-ink-2')}
                key={which}
                onClick={() => setEdit(which)}
                type="button"
              >
                {draft[which]}
              </button>
            ))}
          </div>

          <div className="relative grid grid-cols-[1.4fr_1fr]">
            {/* 选中条横跨两列，不是每列一条——iOS 的 UIDatePicker 就是一条。
                放在网格上而不是各自的 Wheel 里，中间那条缝才不会把它切断。 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[9px] bg-sheet-2"
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

          <div className="mt-3 flex justify-end">
            <button
              className="text-xs text-ink-3 outline-none transition-colors duration-200 hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={commit}
              type="button"
            >
              完成
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
  // **必须在布局阶段对齐。** Popover 是打开那一刻才挂载的，用 `useEffect` 的话
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
        onScroll={() => {
          if (hasScrollEnd) return
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => latest.current(), 140)
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
