import { cn } from '../../lib/cn'
import { money, percent, signedMoney } from '../../lib/format'
import type { PortfolioSnapshot } from '../../api/types'
import type { PnlTopic } from './PnlDetail'

type Cell = {
  label: string
  value: string
  note?: string
  tone?: 'gain' | 'loss' | 'muted'
  /** 可以点开看这个数是怎么算的。没有 topic 的格子不可点 */
  topic?: PnlTopic
}

/**
 * 常驻摘要条。分节导航只管导航，摘要另立一行——
 * 上一版把两件事塞进同一根侧栏，结果既不像导航也不像摘要，还吃掉 224px 宽度。
 */
export function SummaryStrip({ snapshot, futuresMissing, veiled, onOpenDetail }: {
  snapshot: PortfolioSnapshot
  futuresMissing: boolean
  veiled: boolean
  onOpenDetail: (topic: PnlTopic) => void
}) {
  const totals = snapshot.totals
  const pnl = snapshot.pnl
  const ratio = snapshot.futures?.margin_ratio ?? null

  // 现货与合约各有各的取不到的可能：一边缺就只报另一边，别把 null 当 0 加进去
  const sum = (...parts: (number | null | undefined)[]) => {
    const known = parts.filter((p): p is number => p != null)
    return known.length ? known.reduce((a, b) => a + b, 0) : null
  }
  const unreal = sum(pnl?.unrealized.spot_usd, pnl?.unrealized.futures_usd)

  const cells: Cell[] = [
    {
      // 原先是"今日净值变化"，拿全部钱包减昨天的日快照——理财余额每天都被算成
      // "今天赚的"。改成今日实际落袋，只认成交与结算。
      label: '今日盈亏',
      topic: 'today' as const,
      value: pnl?.today_usd == null ? '—' : signedMoney(pnl.today_usd),

      tone: pnl?.today_usd == null ? 'muted' : pnl.today_usd >= 0 ? 'gain' : 'loss',
    },
    {
      // 未实现盈亏来自成交重放（现货）与 positionRisk（合约），不是"期末 − 期初"。
      // 后者在 Binance 上算不准：日快照只有三个钱包，钱包间划转会被算成盈亏。
      label: '未实现盈亏',
      topic: 'unrealized' as const,
      value: unreal == null ? '—' : signedMoney(unreal),
      note: unreal == null ? '不可用' : undefined,
      tone: unreal == null ? 'muted' : unreal >= 0 ? 'gain' : 'loss',
    },
    {
      label: '合约保证金率',
      value: ratio === null ? '—' : percent(ratio, 1),
      note: futuresMissing ? '取不到' : ratio === null ? '—' : ratio < 0.5 ? '安全' : ratio < 0.8 ? '偏紧' : '危险',
      tone: ratio === null ? 'muted' : undefined,
    },
  ]

  return (
    // 净值是**标题**，另外三个是指标——两种东西，不塞进同一排网格。
    //
    // 上一版把四个一起放进三行网格、数字底对齐，结果净值高 40px 而其余高 17px，
    // 差出来的 23px 全挂在了三个小标签下面：净值的标签到数字只有 8px，
    // 另外三个是 31px（实测）。底对齐让净值和指标落在同一基线，代价却是
    // 标签与数字之间被撑开——那是更显眼的错。
    //
    // 现在净值自成一块，三个指标各自是一个共用行槽的子网格：它们之间标签齐、
    // 数字齐、有没有第三行的注都不影响前两行。
    //
    // 两块之间用 `items-baseline`：同一横排里字号不同的数字，眼睛要的是**同一条
    // 基线**。顶对齐会让 40px 的净值和 17px 的指标差出 23px（实测），
    // 和之前底对齐是同一个错位换了个方向。
    <div className={cn('flex flex-wrap items-baseline gap-x-14 gap-y-6',
      'px-5 pb-4 pt-4 sm:px-10 sm:pb-5 sm:pt-5', veiled && 'veiled')}>
      {/* 窄屏净值独占一行：2.5rem 的数字旁边塞不下三个指标，
          `flex-1` 会让它们挤在右边糊成一团（实测溢出 54px）。 */}
      <div className="w-full sm:w-auto">
        <div className="label">净值</div>
        {/* `items-baseline` 对齐的是每块的**第一行文本**（标签），不是数字。
            要让 40px 的净值和 17px 的指标落在同一条数字基线上，只能把两边
            "标签底到数字基线"的距离做成一样：净值那行的距离由字号决定，
            指标那边用 padding 补齐差额（40px 与 17px 的基线差，实测 23px）。 */}
        <div className="tnum mt-2 text-[2rem] font-medium leading-none tracking-[-0.03em] text-ink sm:text-[2.5rem]">
          {totals ? money(totals.equity_usd) : '—'}
        </div>
      </div>

      <div
        className={cn('grid w-full gap-x-8 sm:w-auto sm:gap-x-14',
          // 窄屏三个指标挤不下一排，两列换行；两种情况下同一排都共用行槽
          'grid-cols-2 gap-y-5 sm:auto-cols-max sm:grid-flow-col sm:grid-cols-none sm:gap-y-0')}
        style={{ gridTemplateRows: 'repeat(3, auto)' }}
      >
        {cells.map((cell) => (
          <Cell
            key={cell.label}
            label={cell.label}
            note={cell.note}
            onOpen={cell.topic ? () => onOpenDetail(cell.topic!) : undefined}
            topic={cell.topic}
            value={cell.value}
            valueClass={cn(
              cell.tone === 'gain' ? 'text-gain'
                : cell.tone === 'loss' ? 'text-loss'
                  : cell.tone === 'muted' ? 'text-ink-3' : 'text-ink')}
          />
        ))}
      </div>
    </div>
  )
}

function Cell({ label, value, valueClass, note, onOpen, topic }: {
  label: string
  value: string
  valueClass: string
  note?: string
  onOpen?: () => void
  topic?: PnlTopic
}) {
  // 可点与不可点必须是**同一种盒子**，否则标签的行盒高度不同，两排差几像素
  // （实测差 6px）。都用 `.label` 直接挂在最外层，不再往里套一层 span。
  const labelClass = cn('label self-start text-left', onOpen && cn(
    'group cursor-pointer outline-none transition-colors duration-200 hover:text-ink-2',
    // 下划虚线是"这里能点"的最轻提示，不给它加边框或底色——
    // 摘要条是一排读数，不是一排按钮
    'decoration-rule-strong underline-offset-[5px] hover:underline hover:decoration-dotted',
    'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4',
    'focus-visible:outline-accent'))

  return (
    <div className="row-span-3 grid" style={{ gridTemplateRows: 'subgrid' }}>
      {onOpen ? (
        <button className={labelClass} data-pnl-topic={topic} onClick={onOpen} type="button">
          {label}
        </button>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      {/* 三个指标之间字号一致；`pt` 把它们的基线压到与净值同一条线上。
          窄屏净值独占一行、不同排，就不需要这个补偿。 */}
      <div className={cn('tnum mt-2 self-start text-lg leading-none sm:pt-[23px]', valueClass)}>
        {value}
      </div>
      {/* 只留**读数**：把数字翻成一句判断（"安全""取不到"）。
          口径——这个数怎么算出来的——收进点开的详情里。 */}
      <div className="mt-1 self-start text-xs text-ink-3">{note ?? ''}</div>
    </div>
  )
}
