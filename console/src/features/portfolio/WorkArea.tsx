import { useState } from 'react'
import { cn } from '../../lib/cn'
import { money } from '../../lib/format'
import type { PortfolioSnapshot } from '../../api/types'
import { AttributionPanel } from './Attribution'
import { SpotTable, EarnTable } from './Holdings'
import { PositionsList } from './RiskPanel'

type TabKey = 'attribution' | 'spot' | 'earn' | 'positions'

/**
 * 定高工作区。PC 上把四块明细收进标签页，而不是纵向摞成一条长滚动——
 * 概览常驻在上方与右侧，工作区只换内容，页面本身不动。
 */
export function WorkArea({ snapshot, futuresMissing, veiled }: {
  snapshot: PortfolioSnapshot
  futuresMissing: boolean
  veiled: boolean
}) {
  // 归因算不出来时别把默认标签停在一片空解释上——退到有内容的那个，
  // 用户仍可点回"归因"看为什么不可用。
  const [tab, setTab] = useState<TabKey>(snapshot.attribution ? 'attribution' : 'spot')

  const spotValue = snapshot.spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const earnValue = snapshot.earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const positionCount = snapshot.futures?.positions.length ?? 0

  const tabs: Array<{ key: TabKey; label: string; note: string | null }> = [
    { key: 'attribution', label: '归因', note: snapshot.attribution ? '30 天' : '不可用' },
    { key: 'spot', label: '现货', note: money(spotValue) },
    { key: 'earn', label: '理财', note: money(earnValue) },
    { key: 'positions', label: '合约仓位', note: futuresMissing ? '不可用' : `${positionCount} 笔` },
  ]

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', veiled && 'veiled')}>
      {/* 选中态用下划线指示器。暗色下 bg-surface-2 与 hover 的差异太小，
          分不清哪一个是当前页——这种地方不能靠微弱的背景色差。 */}
      <div className="scrollbar-none flex items-center gap-4 overflow-x-auto border-b border-line sm:gap-5" role="tablist">
        {tabs.map((item) => (
          <button
            aria-selected={tab === item.key}
            className={cn(
              '-mb-px flex shrink-0 items-baseline gap-2 whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors duration-200',
              tab === item.key
                ? 'border-accent text-fg'
                : 'border-transparent text-fg-3 hover:text-fg-2',
            )}
            key={item.key}
            onClick={() => setTab(item.key)}
            role="tab"
            type="button"
          >
            {item.label}
            {item.note && <span className="tnum hidden text-micro text-fg-3 sm:inline">{item.note}</span>}
          </button>
        ))}
      </div>

      <div className="scroll-y flex-1 pt-4 pr-1">
        {tab === 'attribution' && <AttributionPanel data={snapshot.attribution} embedded veiled={false} />}
        {tab === 'spot' && <SpotTable spot={snapshot.spot} />}
        {tab === 'earn' && <EarnTable earn={snapshot.earn} />}
        {tab === 'positions' && (
          <PositionsList futures={snapshot.futures} unavailable={futuresMissing} />
        )}
      </div>
    </div>
  )
}
