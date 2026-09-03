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
    // **三行网格，不是 items-end 的一排盒子。** 原先靠底边对齐，于是"有注的格子"
    // 比"没注的"高一截，它的标签和数字整块被顶上去——删掉两个 note 之后，
    // 「合约保证金率」就明显和另外两个错开了。
    //
    // 每一格用 `grid-template-rows: subgrid` 借父级的行槽，所以标签一排、数字一排、
    // 注一排，有没有注都不影响前两排。`display: contents` 做不到这件事：
    // 窄屏换行之后三个子元素会各自散进列里。
    <div
      className={cn(
        'grid gap-x-14 px-5 pb-4 pt-4 sm:px-10 sm:pb-5 sm:pt-5',
        // 窄屏两列换行，宽屏一排；两种情况下同一排里的格子都共用行槽
        'grid-cols-2 gap-x-8 gap-y-5 sm:auto-cols-max sm:grid-flow-col sm:grid-cols-none sm:gap-x-14 sm:gap-y-0',
        veiled && 'veiled')}
      style={{ gridTemplateRows: 'repeat(3, auto)', gridAutoRows: 'auto' }}
    >
      {/* 净值的字号是其余的两倍多，窄屏两列里塞不下——它会撑破自己那一列，
          把旁边那格的数字挤到贴着。让它独占一整行。 */}
      <Cell
        className="max-sm:col-span-2"
        label="净值"
        value={totals ? money(totals.equity_usd) : '—'}
        valueClass="text-[2rem] font-medium tracking-[-0.03em] text-ink sm:text-[2.5rem]"
      />
      {cells.map((cell) => (
        <Cell
          key={cell.label}
          label={cell.label}
          note={cell.note}
          onOpen={cell.topic ? () => onOpenDetail(cell.topic!) : undefined}
          topic={cell.topic}
          value={cell.value}
          valueClass={cn('text-lg',
            cell.tone === 'gain' ? 'text-gain'
              : cell.tone === 'loss' ? 'text-loss'
                : cell.tone === 'muted' ? 'text-ink-3' : 'text-ink')}
        />
      ))}
    </div>
  )
}

function Cell({ label, value, valueClass, note, onOpen, topic, className }: {
  label: string
  value: string
  valueClass: string
  note?: string
  onOpen?: () => void
  topic?: PnlTopic
  className?: string
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
    <div className={cn('row-span-3 grid', className)} style={{ gridTemplateRows: 'subgrid' }}>
      {onOpen ? (
        <button className={labelClass} data-pnl-topic={topic} onClick={onOpen} type="button">
          {label}
        </button>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      <div className={cn('tnum mt-2 self-end leading-none', valueClass)}>{value}</div>
      {/* 只留**读数**：把数字翻成一句判断（"安全""取不到"）。
          口径——这个数怎么算出来的——收进点开的详情里。 */}
      <div className="mt-1 self-start text-xs text-ink-3">{note ?? ''}</div>
    </div>
  )
}
