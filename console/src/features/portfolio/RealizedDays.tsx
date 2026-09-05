import { useMemo, useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn } from '../../lib/cn'
import { SegmentedControl } from '../../components/controls'
import { signedMoney } from '../../lib/format'
import type { DailyPnl } from '../../api/types'

/**
 * 每日盈亏日历。
 *
 * 两件事各管各的，不打架：
 *
 * - **区间**（7 / 30 / 90 天 / 自定义）决定统计哪些天。区间外的日子照常画出来，
 *   但压暗、不计入合计——日历该显示完整的月份，而不是被区间裁掉一半。
 * - **月份箭头**决定看哪个月。翻月不改区间。
 *
 * 上一版把这两件事混成一个：日历直接由滚动窗口驱动，于是渲染出"8 月从 5 号开始"
 * 和"9 月只有 3 天"两个高矮不一的块。分开之后各自都讲得通。
 *
 * **自定义就在日历上点。** 点第一天定起点、再点一天定终点，中间实时预览。
 * 不另做一个日期控件：日历本来就在屏幕上，让人对着两个输入框敲日期，
 * 而旁边就摆着一整月的格子，是把现成的东西浪费掉。
 *
 * 着色只用很浅的底 + 有色数字，金额一律带正负号——红绿在色盲下分离度只有 ΔE 6.1
 * （验证器实测），光靠底色深浅分不出正负，符号是第二重编码。
 */
// **周日起头。** 中文日历两种排法都常见，这里跟通行的 S M T W T F S 一致。
// 汉字本来就是单字，窄屏不用再缩写。
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const ROWS = 6
const PRESETS = { '7': 7, '30': 30, '90': 90 } as const
type Preset = keyof typeof PRESETS | 'custom'

type Cell = null | {
  date: string
  day: number
  /** 落在可取区间内吗（合约只保留 90 天，未来的日子也没有） */
  known: boolean
  /** 在当前统计区间里吗。区间外照常显示日期，但压暗、不计入合计 */
  inRange: boolean
  value: number
  /** 这天算不算得出来。算不出来的格子不上色、不计入合计 */
  computed: boolean
}

const monthKey = (at: Date) =>
  `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`

function shiftDays(day: string, delta: number) {
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + delta)
  return at.toISOString().slice(0, 10)
}

/**
 * 没有数据时**不挂载**里面那个组件，而不是在它内部提前 return。
 *
 * 之前空数组的判断写在几个 `useMemo` 之后——hook 先跑，守卫永远轮不到，
 * `shiftDays('')` 造出 Invalid Date 直接 `RangeError` 整页白屏。
 * 合约域名 451 时 `pnl` 整块为空，正好踩上（实测 fapi_blocked / no_history
 * 两个场景六个页面全白）。守卫必须在 hook 之前，那就只能提到外面来。
 */
export function RealizedDays({ days }: { days: DailyPnl[] }) {
  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">还没有可用的成交记录。</p>
  }
  return <Calendar days={days} />
}

function Calendar({ days }: { days: DailyPnl[] }) {
  const last = days.at(-1)!.date
  const first = days[0]!.date

  const [preset, setPreset] = useState<Preset>('30')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  /** 自定义的两步：null 表示不在选取中；有值表示已点了起点、正等终点 */
  const [anchor, setAnchor] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [cursor, setCursor] = useState(() => {
    const at = new Date(`${last}T00:00:00Z`)
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  })

  const range = useMemo(() => {
    if (preset === 'custom') {
      if (anchor !== null) {
        // 选取中：起点到光标之间实时预览，还没落笔就先照着起点当一天算
        const edge = hover ?? anchor
        return anchor <= edge ? { from: anchor, to: edge } : { from: edge, to: anchor }
      }
      return custom ?? { from: first, to: last }
    }
    return { from: shiftDays(last, -(PRESETS[preset] - 1)), to: last }
  }, [anchor, custom, first, hover, last, preset])

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])

  const month = useMemo(() => {
    const year = cursor.getUTCFullYear()
    const index = cursor.getUTCMonth()
    const total = new Date(Date.UTC(year, index + 1, 0)).getUTCDate()
    // 周日起头：getUTCDay() 里周日就是 0，直接用
    const lead = new Date(Date.UTC(year, index, 1)).getUTCDay()

    const flat: Cell[] = Array(lead).fill(null)
    for (let day = 1; day <= total; day += 1) {
      const date = `${year}-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const hit = byDate.get(date)
      flat.push({
        date, day, known: hit !== undefined,
        inRange: date >= range.from && date <= range.to,
        value: hit?.pnl_usd ?? 0, computed: hit?.known ?? false,
      })
    }
    // 补满六行：五周与六周的月份切换时，日历高度不该跳
    while (flat.length < ROWS * 7) flat.push(null)

    const counted = (cell: Cell): cell is NonNullable<Cell> =>
      cell !== null && cell.known && cell.inRange && cell.computed

    return {
      label: `${year} 年 ${index + 1} 月`,
      weeks: Array.from({ length: ROWS }, (_, i) => {
        const cells = flat.slice(i * 7, i * 7 + 7)
        const live = cells.filter(counted)
        return {
          key: `${year}-${index}-${i}`,
          cells,
          total: live.reduce((sum, c) => sum + c.value, 0),
          computed: live.length,
          empty: cells.every((c) => c === null),
        }
      }),
      total: flat.filter(counted).reduce((sum, c) => sum + c.value, 0),
      computed: flat.filter(counted).length,
    }
  }, [byDate, cursor, range])

  // 合计描述的是**区间**，不是当前这个月——区间可能横跨好几个月
  const scope = useMemo(() => {
    const live = days.filter((d) => d.known && d.date >= range.from && d.date <= range.to)
    const span = days.filter((d) => d.date >= range.from && d.date <= range.to).length
    return {
      span,
      computed: live.length,
      wins: live.filter((d) => (d.pnl_usd ?? 0) > 0).length,
      total: live.reduce((sum, d) => sum + (d.pnl_usd ?? 0), 0),
      peak: Math.max(...live.map((d) => Math.abs(d.pnl_usd ?? 0)), 1),
    }
  }, [days, range])

  const key = monthKey(cursor)
  // 数据只有 90 天，翻到头就把箭头禁掉——而不是翻出一片空月历
  const canPrev = key > monthKey(new Date(`${first}T00:00:00Z`))
  const canNext = key < monthKey(new Date(`${last}T00:00:00Z`))
  const step = (delta: number) => setCursor((at) =>
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + delta, 1)))

  const pick = (date: string) => {
    if (preset !== 'custom') return
    if (anchor === null) { setAnchor(date); return }
    const [from, to] = anchor <= date ? [anchor, date] : [date, anchor]
    setCustom({ from, to })
    setAnchor(null)
    setHover(null)
  }

  const choosePreset = (next: Preset) => {
    setPreset(next)
    setAnchor(next === 'custom' ? null : null)
    if (next === 'custom') {
      setCustom(null)
    } else {
      // 换区间时把日历翻到区间末尾那个月，否则选了"7 天"却还停在三个月前
      const at = new Date(`${last}T00:00:00Z`)
      setCursor(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)))
    }
  }

  const picking = preset === 'custom' && (anchor !== null || custom === null)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <SegmentedControl
          items={[
            ...(Object.keys(PRESETS) as (keyof typeof PRESETS)[])
              .map((k) => ({ value: k as Preset, label: `${k} 天` })),
            { value: 'custom' as Preset, label: '自定义' },
          ]}
          label="统计区间"
          onValueChange={choosePreset}
          size="sm"
          value={preset}
        />
        <span className="tnum text-micro text-ink-3">
          {picking
            ? (anchor === null ? '在日历上点一天作为起点' : '再点一天作为终点')
            : `${range.from} — ${range.to}`}
        </span>
      </div>

      {/* 窄屏 335px：月份标题 120px + 两个箭头 48px + gap，两侧各只剩 67px，
          "−$577.58" 排不下就折成两行。标题在窄屏收窄，金额一律不折。 */}
      <header className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 sm:gap-x-4">
        <span />
        <span className="flex items-center gap-0.5 sm:gap-1">
          <Arrow disabled={!canPrev} label="上一月" onClick={() => step(-1)} />
          <h3 className="tnum min-w-[6rem] text-center text-xs text-ink sm:min-w-[7.5rem] sm:text-sm">
            {month.label}
          </h3>
          <Arrow disabled={!canNext} forward label="下一月" onClick={() => step(1)} />
        </span>
        <span className={cn('tnum justify-self-end whitespace-nowrap text-xs sm:text-sm',
          month.computed === 0 ? 'text-ink-3'
            : month.total >= 0 ? 'text-gain' : 'text-loss')}>
          {month.computed === 0 ? '—' : signedMoney(month.total)}
        </span>
      </header>

      <div
        className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(7,minmax(0,1fr))_minmax(3.6rem,0.75fr)] sm:gap-1.5"
        onPointerLeave={() => setHover(null)}
      >
        {/* 周末不压暗了：币是 7×24 的，资金费周末照样结算，持仓周末照样涨跌。
            压暗等于说"这两天不太算数"，而现在每一天都是真实盈亏。 */}
        {WEEKDAYS.map((day) => (
          <span className="pb-2 text-center text-micro text-ink-3" key={day}>{day}</span>
        ))}
        <span className="hidden pb-1.5 pl-3 text-right text-micro text-ink-3 sm:block">本周</span>

        {month.weeks.map((week) => (
          <div className="contents" key={week.key}>
            {week.cells.map((cell, index) => (
              <DayCell
                cell={cell}
                key={cell?.date ?? `${week.key}-${index}`}
                onHover={setHover}
                onPick={pick}
                peak={scope.peak}
                picking={picking}
                today={last}
              />
            ))}
            <span className={cn(
              'tnum hidden items-center justify-end pl-3 text-[11px] sm:flex',
              // 整月之外的补位行不画分界线：那条线原先一路穿到底，末尾拖着一截空竖线
              !week.empty && 'border-l border-rule',
              week.total > 0 ? 'text-gain' : week.total < 0 ? 'text-loss' : 'text-ink-3/45',
            )}>
              {week.empty ? '' : week.computed === 0 ? '—' : signedMoney(week.total)}
            </span>
          </div>
        ))}
      </div>

      {/* 这一行描述的是**区间**，不是当前这个月：区间可以横跨几个月。
          窄屏必须一行放得下，折行会让固定高度的模块在切月时上下跳。 */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-rule pt-3">
        <span className="tnum text-xs text-ink-3">
          {/* "N 天有交易"这条没了：现货不成交也在涨跌，每天都有盈亏。
              留下的是"算不出来"的天数，而且只在真的有的时候才说。 */}
          区间 {scope.span} 天 · {scope.wins} 天为正
          {scope.span > scope.computed && (
            <span className="text-loss"> · {scope.span - scope.computed} 天算不出来</span>
          )}
        </span>
        <span className="tnum text-xs text-ink-3">
          合计
          <span className={cn('ml-2 text-sm',
            scope.computed === 0 ? 'text-ink-3'
              : scope.total >= 0 ? 'text-gain' : 'text-loss')}>
            {scope.computed === 0 ? '—' : signedMoney(scope.total)}
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

function DayCell({ cell, peak, picking, onPick, onHover, today }: {
  cell: Cell
  peak: number
  picking: boolean
  onPick: (date: string) => void
  onHover: (date: string | null) => void
  today: string
}) {
  // 月首月末的补位格：不属于这个月，**整格不画**（不是画一个空色块）
  if (cell === null) return <span aria-hidden="true" className="min-h-[54px]" />

  const { day, known, inRange, computed, value } = cell
  const paint = known && inRange && computed && value !== 0
  // 深浅按金额大小。参考的那张图用同一个深浅，于是 +0.17 和 +68.29 一样绿——
  // 白丢掉了"哪几天真的要紧"。下限抬到 9%，小额也还看得见。
  const weight = paint ? Math.abs(value) / peak : 0
  // **只有有数据的日子能选。** 上一版让整月都可点，于是能选出 09-05 — 09-19
  // 这种全在未来、区间 0 天的范围——选得出来但什么也没有。
  const selectable = picking && known
  const Tag = selectable ? 'button' : 'div'

  return (
    // 每天一块独立的圆角色块，靠间距分隔而不是描边——三十多个方框会把这一页
    // 压成一张表单。
    <Tag
      // 窄屏一格只有 41px 宽，px-2 的内边距就吃掉 16px——金额放不下。
      // 内边距和字号都跟着断点走，别指望 truncate 兜底：截断的金额是错的数字。
      className={cn('flex min-h-[54px] w-full flex-col justify-between rounded-[5px]',
        'px-1.5 py-1.5 sm:px-2',
        'text-left transition-colors duration-150',
        !known && 'bg-sheet-2/30',                    // 可取区间之外 / 未来
        known && !paint && 'bg-sheet-2/60',           // 有这天但算不出来 / 恰好为 0
        !inRange && 'opacity-40',                     // 不在统计区间里：整格压暗
        // 今天：一圈细环。这是所有格子里最先被找的那一个
        cell.date === today && 'ring-1 ring-inset ring-rule-strong',
        selectable && 'cursor-pointer hover:ring-1 hover:ring-accent',
        selectable && 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent',
        // 选取中但这天没数据：明确标成不可选，而不是看着能点、点了没反应
        picking && !known && 'cursor-not-allowed',
      )}
      onClick={selectable ? () => onPick(cell.date) : undefined}
      onPointerEnter={selectable ? () => onHover(cell.date) : undefined}
      style={weight > 0 ? {
        backgroundColor: `color-mix(in oklab, var(--${value >= 0 ? 'gain' : 'loss'}) ${
          (9 + weight * 20).toFixed(1)}%, transparent)`,
      } : undefined}
      title={!known ? `${cell.date} 不在可取区间内`
        : computed ? `${cell.date} ${signedMoney(value)}` : `${cell.date} 算不出来`}
      {...(selectable ? { type: 'button' as const } : {})}
    >
      {/* 日期是这张表的索引，要一眼找得到——原先 11px 的灰字比金额还轻，
          翻月的时候要盯着找。金额在下面，颜色与符号各是一重编码。 */}
      <span className={cn('tnum text-xs font-medium leading-none sm:text-sm',
        known ? 'text-ink' : 'text-ink-3/45')}>
        {day}
      </span>
      {paint && (
        <span className={cn('tnum text-[11px] leading-none sm:text-xs',
          value > 0 ? 'text-gain' : 'text-loss')}>
          {compact(value)}
        </span>
      )}
    </Tag>
  )
}

/**
 * 格子窄，`$1,234.56` 放不下。位数跟着量级走，最长五个字符（`+41.6` / `+1.2k`）。
 *
 * 十以下留两位小数：这个账户不少天就是几毛钱，一律取整会印成 `+0`，看着像没赚。
 * 符号一律保留——红绿在色盲下分离度只有 ΔE 6.1，符号是第二重编码。
 */
function compact(value: number) {
  const sign = value > 0 ? '+' : '−'
  const abs = Math.abs(value)
  if (abs < 10) return `${sign}${abs.toFixed(2)}`
  if (abs < 100) return `${sign}${abs.toFixed(1)}`
  if (abs < 1000) return `${sign}${Math.round(abs)}`
  return `${sign}${(abs / 1000).toFixed(abs < 10_000 ? 1 : 0)}k`
}
