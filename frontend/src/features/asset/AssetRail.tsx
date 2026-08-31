import type { AssetIndex, AssetRow } from './types'
import { rateDisplay } from './format'

export type SortKey = 'units' | 'recent' | 'open'

export const sortLabels: Record<SortKey, string> = {
  units: '沉淀量',
  recent: '最近',
  open: '未到期',
}

/**
 * 常驻标的栏：选中一个标的时它不消失，换标的是一次点击而不是一次返回。
 *
 * 这是这一页与之前"列表页 → 详情页"最大的差别——日常使用是在标的之间来回比，
 * 每次都退回列表再进去，比翻页还慢。
 */
function AssetRail({ index, rows, state, selected, query, sort, assetClass, onQuery, onSort, onClass, onOpen }: {
  index: AssetIndex | null
  rows: AssetRow[]
  state: 'loading' | 'loaded' | 'error'
  selected: string | null
  query: string
  sort: SortKey
  assetClass: string | null
  onQuery: (value: string) => void
  onSort: (value: SortKey) => void
  onClass: (value: string | null) => void
  onOpen: (asset: string) => void
}) {
  const classes = Object.entries(index?.classes ?? {})
  return (
    <aside className="asset-rail" aria-label="标的列表">
      <header>
        <span>标的</span>
        <b>{state === 'loading' ? '—' : `${rows.length}/${index?.total ?? 0}`}</b>
      </header>
      <label className="asset-rail-search">
        <span aria-hidden="true">⌕</span>
        <input
          aria-label="检索标的"
          onChange={(event) => onQuery(event.target.value)}
          placeholder="代码或名称"
          value={query}
        />
      </label>
      <div className="asset-rail-tools">
        <div role="group" aria-label="排序">
          {(Object.keys(sortLabels) as SortKey[]).map((key) => (
            <button aria-pressed={sort === key} key={key} onClick={() => onSort(key)} type="button">
              {sortLabels[key]}
            </button>
          ))}
        </div>
        <select
          aria-label="按类别过滤"
          onChange={(event) => onClass(event.target.value || null)}
          value={assetClass ?? ''}
        >
          <option value="">全部类别</option>
          {classes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <ol>
        {state === 'loading' && [0, 1, 2, 3, 4, 5].map((key) => <li className="asset-rail-skeleton" key={key}><i /></li>)}
        {state === 'error' && <li className="asset-rail-empty">标的索引暂时不可用。</li>}
        {state === 'loaded' && rows.length === 0 && <li className="asset-rail-empty">没有匹配的标的。</li>}
        {rows.map((row) => {
          const rate = rateDisplay(row)
          return (
            <li key={row.asset}>
              <button
                aria-current={selected === row.asset ? 'true' : undefined}
                onClick={() => onOpen(row.asset)}
                type="button"
              >
                <span className="asset-rail-name">
                  <strong>{row.display ?? row.asset}</strong>
                  <em>{row.asset}</em>
                </span>
                <span className="asset-rail-stats">
                  <i>{row.units} 单元</i>
                  {row.open_claims > 0 && <i className="live">{row.open_claims} 未到期</i>}
                  <i data-small={rate.small ? 'true' : undefined}>
                    {rate.isRate ? `${rate.text} n=${row.scored}` : rate.text}
                  </i>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

export default AssetRail
