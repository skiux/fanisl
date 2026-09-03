import { useMemo, useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { signedMoney } from '../../lib/format'
import type { DailyRealized } from '../../api/types'

/**
 * 每日盈亏日历。**按月浏览，不按滚动窗口。**
 *
 * 上一版把两个模型混在一起：日历由 7/30/90 天的滚动窗口驱动，于是渲染出
 * "8 月从 5 号开始"和"9 月只有 3 天"两个高矮不一的块——它不是一个东西，
 * 所以怎么调都差点意思。窗口回答的是"最近怎么样"，那件事上面的摘要条已经答了；
 * 日历回答的是"某个月过得怎么样"，那就该按月翻。
 *
 * 六行固定高度：五周的月份和六周的月份切换时版面不该跳。
 *
 * 着色只用很浅的底 + 有色数字，金额一律带正负号——红绿在色盲下分离度只有 ΔE 6.1
 * （验证器实测），光靠底色深浅分不出正负，符号是第二重编码。
 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const ROWS = 6

/**
 * 一格。`null` 只用于**月首月末的补位**，不用于"这天没数据"——
 * 上一版把窗口外的日期也渲染成空白，于是当月只画出有数据的那几天，
 * 剩下一大片虚空。日历要画出整个月的每一天：没有数据的日子仍然是这个月的日子。
 */
type Cell = null | {
  date: string
  day: number
  /** 有没有落在可取区间内（合约只保留 90 天，未来的日子也没有） */
  known: boolean
  value: number
  traded: boolean
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function RealizedDays({ days }: { days: DailyRealized[] }) {
  const bounds = useMemo(() => {
    if (days.length === 0) return null
    return {
      first: new Date(`${days[0]!.date}T00:00:00Z`),
      last: new Date(`${days.at(-1)!.date}T00:00:00Z`),
    }
  }, [days])

  const [cursor, setCursor] = useState(() => {
    const last = days.at(-1)?.date
    const at = last ? new Date(`${last}T00:00:00Z`) : new Date()
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  })

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])

  const month = useMemo(() => {
    const year = cursor.getUTCFullYear()
    const index = cursor.getUTCMonth()
    const total = new Date(Date.UTC(year, index + 1, 0)).getUTCDate()
    // 周一起头：getUTCDay() 里周日是 0，挪到末位
    const lead = (new Date(Date.UTC(year, index, 1)).getUTCDay() + 6) % 7

    const flat: Cell[] = Array(lead).fill(null)
    for (let day = 1; day <= total; day += 1) {
      const iso = `${year}-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const hit = byDate.get(iso)
      flat.push({
        date: iso, day, known: hit !== undefined,
        value: hit?.realized_usd ?? 0, traded: hit?.traded ?? false,
      })
    }
    // 补满六行：五周与六周的月份切换时，日历高度不该跳
    while (flat.length < ROWS * 7) flat.push(null)

    const weeks = Array.from({ length: ROWS }, (_, i) => {
      const cells = flat.slice(i * 7, i * 7 + 7)
      const live = cells.filter((c): c is NonNullable<Cell> => c !== null && c.known && c.traded)
      return {
        key: `${year}-${index}-${i}`,
        cells,
        total: live.reduce((sum, c) => sum + c.value, 0),
        traded: live.length,
        empty: cells.every((c) => c === null),
      }
    })
    const live = flat.filter((c): c is NonNullable<Cell> => c !== null && c.known && c.traded)
    return {
      label: `${year} 年 ${index + 1} 月`,
      weeks,
      total: live.reduce((sum, c) => sum + c.value, 0),
      traded: live.length,
      wins: live.filter((c) => c.value > 0).length,
      peak: Math.max(...live.map((c) => Math.abs(c.value)), 1),
      covered: flat.filter((c) => c !== null && c.known).length,
      inMonth: total,
    }
  }, [byDate, cursor])

  if (bounds === null) {
    return <p className="py-10 text-center text-sm text-ink-3">还没有可用的成交记录。</p>
  }

  const key = monthKey(cursor)
  // 数据只有 90 天，翻到头就把箭头禁掉——而不是翻出一片空月历
  const canPrev = key > monthKey(bounds.first)
  const canNext = key < monthKey(bounds.last)
  const step = (delta: number) => setCursor((at) =>
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + delta, 1)))

  return (
    <>
      <header className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <span />
        <span className="flex items-center gap-1">
          <Arrow disabled={!canPrev} label="上一月" onClick={() => step(-1)} />
          <h4 className="tnum min-w-[7.5rem] text-center text-sm text-ink">{month.label}</h4>
          <Arrow disabled={!canNext} forward label="下一月" onClick={() => step(1)} />
        </span>
        <span className={cn('tnum justify-self-end text-sm',
          month.traded === 0 ? 'text-ink-3'
            : month.total >= 0 ? 'text-gain' : 'text-loss')}>
          {month.traded === 0 ? '—' : signedMoney(month.total)}
        </span>
      </header>

      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-x-1 sm:grid-cols-[repeat(7,minmax(0,1fr))_minmax(3.6rem,0.75fr)]">
        {WEEKDAYS.map((day, index) => (
          <span
            className={cn('pb-1.5 text-center text-micro',
              // 周末压暗一档：不是隐藏（合约的资金费周末照样结算），只是让工作日先跳出来
              index >= 5 ? 'text-ink-3/55' : 'text-ink-3')}
            key={day}
          >
            {day}
          </span>
        ))}
        <span className="hidden pb-1.5 pl-3 text-right text-micro text-ink-3 sm:block">本周</span>

        {month.weeks.map((week) => (
          <div className="contents" key={week.key}>
            {week.cells.map((cell, index) => (
              <DayCell cell={cell} key={cell?.date ?? `${week.key}-${index}`} peak={month.peak} />
            ))}
            <span className={cn(
              'tnum hidden items-center justify-end pl-3 text-[11px] sm:flex',
              // 整月之外的补位行不画分界线：那条线原先一路穿到底，末尾拖着一截空竖线
              !week.empty && 'border-l border-rule',
              week.total > 0 ? 'text-gain' : week.total < 0 ? 'text-loss' : 'text-ink-3/45',
            )}>
              {week.empty ? '' : week.traded === 0 ? '—' : signedMoney(week.total)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-rule pt-3">
        {/* 这一行在窄屏必须一行放得下：折成两行会让"固定高度"的日历模块
            在切月时上下跳（实测 468↔484）。所以覆盖度写成最短的形式。 */}
        <span className="tnum text-xs text-ink-3">
          {month.traded} 天有交易 · {month.wins} 天为正
          {month.covered < month.inMonth && ` · ${month.covered}/${month.inMonth} 天有数据`}
        </span>
        <span className="tnum text-xs text-ink-3">
          胜率
          <span className="ml-2 text-ink-2">
            {month.traded === 0 ? '—' : `${Math.round(month.wins / month.traded * 100)}%`}
          </span>
        </span>
      </div>
    </>
  )
}

function Arrow({ onClick, disabled, label, forward }: {
  onClick: () => void
  disabled: boolean
  label: string
  forward?: boolean
}) {
  const Icon = forward ? CaretRight : CaretLeft
  return (
    <button
      aria-label={label}
      className={cn('grid size-6 place-items-center rounded-[var(--radius-control)]',
        'text-ink-3 transition-colors duration-200',
        'hover:bg-sheet-2 hover:text-ink disabled:pointer-events-none disabled:opacity-25',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1',
        'focus-visible:outline-accent')}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={13} weight="bold" />
    </button>
  )
}

function DayCell({ cell, peak }: { cell: Cell; peak: number }) {
  // 月首月末的补位格：不属于这个月，留空
  if (cell === null) return <span aria-hidden="true" className="min-h-[52px]" />

  const { day, known, traded, value } = cell
  const paint = known && traded && value !== 0
  const weight = paint ? Math.abs(value) / peak : 0

  return (
    // 不给每个格子描边：三十多个方框会把这一页压成一张表单。
    // 分隔靠留白，深浅靠底色——发丝线只留给"本周"那一列的分界。
    <div
      className={cn('flex min-h-[52px] flex-col justify-between rounded-[3px] px-2 py-1.5',
        !known && 'bg-sheet-2/35',              // 区间外 / 未来：更淡的底
        known && !paint && 'bg-sheet-2/70',     // 有数据但没交易
      )}
      style={weight > 0 ? {
        backgroundColor: `color-mix(in oklab, var(--${value >= 0 ? 'gain' : 'loss'}) ${
          (6 + weight * 15).toFixed(1)}%, transparent)`,
      } : undefined}
      title={!known ? `${cell.date} 不在可取区间内`
        : traded ? `${cell.date} ${signedMoney(value)}` : `${cell.date} 没有交易`}
    >
      <span className={cn('tnum text-micro leading-none',
        known ? 'text-ink-3' : 'text-ink-3/40')}>
        {day}
      </span>
      {paint && (
        <span className={cn('tnum truncate text-right text-[11px] leading-none',
          value > 0 ? 'text-gain' : 'text-loss')}>
          {compact(value)}
        </span>
      )}
    </div>
  )
}

/** 格子窄，$1,234.56 放不下。千位以上压成 1.2k；符号一律保留——它是正负的第二重编码 */
function compact(value: number) {
  const sign = value > 0 ? '+' : '−'
  const abs = Math.abs(value)
  if (abs < 1) return `${sign}${abs.toFixed(2)}`
  if (abs < 1000) return `${sign}${Math.round(abs)}`
  return `${sign}${(abs / 1000).toFixed(abs < 10_000 ? 1 : 0)}k`
}
