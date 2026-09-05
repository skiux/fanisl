import { useLayoutEffect, useRef, useState } from 'react'
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
 * 滚轮用 CSS `scroll-snap`，没有手写动画与指针事件——浏览器自带惯性与吸附。
 * 每一项同时是按钮：鼠标上滚轮不好用，点一下就选中。
 */
const ITEM = 36
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

  const start = () => {
    // 默认：右边是最后一天（"现在"），左边往前推一个月
    setDraft(value ?? { from: clamp(iso(new Date(Date.parse(`${last}T00:00:00Z`) - 29 * MS_DAY)), first, last), to: last })
    setEdit('from')
    setOpen(true)
    onOpen()
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

          <div className="grid grid-cols-[1.4fr_1fr] gap-2">
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
  const settle = useRef<number | undefined>(undefined)
  /** 程序在滚的时候别回读位置，见下 */
  const driving = useRef(0)
  const index = Math.max(0, items.findIndex((item) => item.value === value))

  // 上下各留两格空白，第一项与最后一项才能停在中间。
  // 于是"第 i 项居中"恰好等于 scrollTop = i × 行高，取值与回填都只有这一条算式。
  //
  // 两处踩过的坑，改动前先读：
  //
  // **必须在布局阶段对齐。** Popover 是打开那一刻才挂载的，用 `useEffect` 的话
  // 首帧容器还没布局，滚动请求落空——打开看到的是停在 0 的滚轮。
  //
  // **不能用 `behavior: 'smooth'`。** 容器是 `scroll-snap-type: y mandatory`，
  // 吸附会把程序发起的平滑滚动取消掉：实测点 7 月，字段变成 7 月而滚轮纹丝不动
  // （effect 确实跑了、scrollTo 也调了，位置就是不动）。瞬时对位没有这个问题。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const top = index * ITEM
    if (Math.abs(el.scrollTop - top) < 2) return
    // 瞬时跳也会触发一次 scroll，锁住下面那个回读，免得它把值又读回去
    driving.current = Date.now() + 200
    el.scrollTo({ top, behavior: 'auto' })
  }, [index])

  return (
    <div className="relative" style={{ height: VISIBLE * ITEM }}>
      {/* 中间那一格的底：滚轮停在哪，哪一项就落进这个框里 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[3px] bg-sheet-2"
        style={{ height: ITEM }}
      />
      {/* `relative` 不能少：定位元素会盖在普通流内容之上，不给滚动容器也定位的话，
          这块高亮底会把正中间那一项的文字整个遮住——打开看到的是一道空框。 */}
      <div
        aria-label={label}
        className="scroll-y relative h-full snap-y snap-mandatory"
        onScroll={() => {
          // 滚停之后再取值：滚动途中每一帧都回写会跟平滑滚动打架
          window.clearTimeout(settle.current)
          settle.current = window.setTimeout(() => {
            const el = ref.current
            if (!el || Date.now() < driving.current) return
            const hit = items[Math.min(items.length - 1,
                                       Math.max(0, Math.round(el.scrollTop / ITEM)))]
            if (hit && hit.value !== value) onChange(hit.value)
          }, 120)
        }}
        ref={ref}
      >
        <div style={{ paddingBlock: ((VISIBLE - 1) / 2) * ITEM }}>
          {items.map((item) => (
            <button
              // 鼠标上滚轮不好用，每一项同时是按钮
              className={cn('tnum flex w-full snap-center items-center justify-center',
                'text-xs outline-none transition-colors duration-200',
                item.value === value ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
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
