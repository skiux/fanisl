import { Fragment, useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { DateRangeInput, SegmentedControl } from '../../components/controls'
import { signedMoney } from '../../lib/format'
import type { DailyRealized } from '../../api/types'

/**
 * 每日已实现盈亏日历。
 *
 * 前三版都错了，而且错在同一件事上：我把"日历"换成了自己觉得更好的东西——
 * 先是 GitHub 那种色块热力图（读数只在悬浮时出现，手机上没有悬浮），
 * 再是一格一格的方块网格（不按星期排，读不出"周几"这个交易者最关心的维度），
 * 最后是零线柱状图（那是走势图，不是日历）。
 *
 * 看了 TradeZella / Tradervue / TradesViz 三家的做法，交易日志的 P&L 日历是同一套：
 *
 * - **月网格，星期分列**。看"周几容易亏"是这个视图存在的主要理由之一。
 * - **右侧一列周合计**。三家都有。
 * - 格子里日期小而淡、金额是主角，绿红着色。
 * - **没交易的日子留空**，不写"—"：空白本身就是信息（那天没做单）。
 * - 热力图不是没用，但那是**年视图**的做法；月视图就该是规规矩矩的日历。
 *
 * 着色只用很浅的底 + 有色数字：红绿在色盲下的分离度只有 ΔE 6.1，光靠底色的深浅
 * 分不出正负，所以金额一律带正负号——符号是第二重编码。
 */
const PRESETS = { '7': 7, '30': 30, '90': 90 } as const
type Preset = keyof typeof PRESETS | 'custom'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

type Cell = { date: string; value: number; traded: boolean } | null
type Week = { key: string; cells: Cell[]; total: number; traded: number }

/** 按自然月切开，每月再按周（周一起）铺成网格。窗口外与本月外的格子留空。 */
function toMonths(days: DailyRealized[]) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const months: { key: string; label: string; weeks: Week[]; total: number }[] = []
  if (days.length === 0) return months

  const first = new Date(`${days[0]!.date}T00:00:00Z`)
  const last = new Date(`${days.at(-1)!.date}T00:00:00Z`)
  const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1))

  while (cursor <= last) {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth()
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    // 周一起：getUTCDay() 里周日是 0，挪成 6
    const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7

    const flat: Cell[] = Array(lead).fill(null)
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const hit = byDate.get(iso)
      flat.push(hit ? { date: iso, value: hit.realized_usd, traded: hit.traded } : null)
    }
    while (flat.length % 7 !== 0) flat.push(null)

    const weeks: Week[] = []
    for (let i = 0; i < flat.length; i += 7) {
      const cells = flat.slice(i, i + 7)
      // 整周都在窗口外就不占一行。窗口从月中开始时，月初那一两周全是空格子，
      // 画出来是几行空白加一个"—"的周合计。
      if (cells.every((cell) => cell === null)) continue
      const live = cells.filter((c): c is NonNullable<Cell> => c !== null && c.traded)
      weeks.push({
        key: `${year}-${month}-${i}`,
        cells,
        total: live.reduce((sum, c) => sum + c.value, 0),
        traded: live.length,
      })
    }
    if (weeks.length === 0) { cursor.setUTCMonth(month + 1); continue }
    months.push({
      key: `${year}-${month}`,
      label: `${year} 年 ${month + 1} 月`,
      weeks,
      total: weeks.reduce((sum, w) => sum + w.total, 0),
    })
    cursor.setUTCMonth(month + 1)
  }
  return months
}

export function RealizedDays({ days, maxDays }: { days: DailyRealized[]; maxDays: number }) {
  const [preset, setPreset] = useState<Preset>('30')
  const [range, setRange] = useState(() => ({
    from: days[0]?.date ?? '', to: days.at(-1)?.date ?? '',
  }))

  const shown = useMemo(() => {
    if (preset === 'custom') {
      return days.filter((d) => d.date >= range.from && d.date <= range.to)
    }
    return days.slice(-PRESETS[preset])
  }, [days, preset, range])

  const months = useMemo(() => toMonths(shown), [shown])

  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">还没有可用的成交记录。</p>
  }

  const peak = Math.max(...shown.map((d) => Math.abs(d.realized_usd)), 1)
  const traded = shown.filter((d) => d.traded)
  const wins = traded.filter((d) => d.realized_usd > 0).length
  const total = shown.reduce((sum, d) => sum + d.realized_usd, 0)

  const options = (Object.keys(PRESETS) as (keyof typeof PRESETS)[])
    .filter((key) => PRESETS[key] <= maxDays)
    .map((key) => ({ value: key as Preset, label: `${key} 天` }))

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SegmentedControl
          items={[...options, { value: 'custom' as Preset, label: '自定义' }]}
          label="统计区间"
          onValueChange={setPreset}
          size="sm"
          value={preset}
        />
        {preset === 'custom' && (
          <DateRangeInput
            from={range.from}
            max={days.at(-1)?.date}
            min={days[0]?.date}
            onChange={setRange}
            to={range.to}
          />
        )}
      </div>

      <div className="space-y-7">
        {months.map((month) => (
          <section key={month.key}>
            <header className="mb-2 flex items-baseline justify-between gap-4 border-b border-rule pb-1.5">
              <h4 className="text-xs text-ink-2">{month.label}</h4>
              <span className={cn('tnum text-xs',
                month.total > 0 ? 'text-gain' : month.total < 0 ? 'text-loss' : 'text-ink-3')}>
                {signedMoney(month.total)}
              </span>
            </header>

            {/* 七列日期 + 一列周合计。窄屏放不下周合计那列，收起来 */}
            <div className="grid grid-cols-7 gap-px sm:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,0.9fr)]">
              {WEEKDAYS.map((day) => (
                <span className="pb-1 text-center text-micro text-ink-3" key={day}>{day}</span>
              ))}
              <span className="hidden pb-1 text-right text-micro text-ink-3 sm:block">本周</span>

              {month.weeks.map((week) => (
                <Fragment key={week.key}>
                  {week.cells.map((cell, index) => (
                    <DayCell cell={cell} key={cell?.date ?? `${week.key}-${index}`} peak={peak} />
                  ))}
                  <span className={cn(
                    'hidden items-baseline justify-end gap-1.5 self-center pl-2 sm:flex',
                    week.traded === 0 && 'opacity-35',
                  )}>
                    <span className={cn('tnum text-[11px]',
                      week.total > 0 ? 'text-gain' : week.total < 0 ? 'text-loss' : 'text-ink-3')}>
                      {week.traded === 0 ? '—' : signedMoney(week.total)}
                    </span>
                  </span>
                </Fragment>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-rule pt-3">
        <span className="tnum text-xs text-ink-3">
          {shown.length} 天 · {traded.length} 天有交易 · {wins} 天为正
        </span>
        <span className="tnum text-xs text-ink-3">
          合计
          <span className={cn('ml-2 text-sm', total >= 0 ? 'text-gain' : 'text-loss')}>
            {signedMoney(total)}
          </span>
        </span>
      </div>
    </>
  )
}

function DayCell({ cell, peak }: { cell: Cell; peak: number }) {
  if (cell === null) return <span aria-hidden="true" />
  const { value, traded } = cell
  const day = Number(cell.date.slice(8))
  // 底色极浅：这套视觉是纸面，重色块会把整页压垮。深浅只做次要提示，
  // 正负靠数字的符号与颜色——红绿在色盲下分不开。
  const weight = traded && value !== 0 ? Math.abs(value) / peak : 0
  return (
    <div
      // 边框对所有格子一视同仁：上一版给无交易的格子加边框、给有色的去掉，
      // 同一张网格里两种画法，看着像两套东西。深浅由底色说，不由边框说。
      className="min-h-[46px] rounded-[2px] border border-rule/60 px-1.5 py-1"
      style={weight > 0 ? {
        backgroundColor: `color-mix(in oklab, var(--${value >= 0 ? 'gain' : 'loss'}) ${
          (5 + weight * 13).toFixed(1)}%, transparent)`,
      } : undefined}
      title={traded ? `${cell.date} ${signedMoney(value)}` : `${cell.date} 没有交易`}
    >
      <div className="tnum text-micro leading-none text-ink-3">{day}</div>
      {traded && value !== 0 && (
        <div className={cn('tnum mt-1 truncate text-[11px] leading-tight',
          value > 0 ? 'text-gain' : 'text-loss')}>
          {compact(value)}
        </div>
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
