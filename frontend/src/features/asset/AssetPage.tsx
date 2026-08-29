import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import { isAssetDossier, isAssetIndex } from '../../shared/api/contracts'
import AppHeader from '../../shared/navigation/AppHeader'
import AssetDossier from './AssetDossier'
import { SMALL_SAMPLE, classRank, formatDate, percent } from './format'
import type { AssetDossierData, AssetIndex, AssetRow } from './types'
import './asset.css'

type LoadState = 'loading' | 'loaded' | 'error'
type SortKey = 'units' | 'recent' | 'open'

const sortLabels: Record<SortKey, string> = {
  units: '沉淀量',
  recent: '最近提及',
  open: '未到期',
}

function readAssetFromHash() {
  const [, search = ''] = window.location.hash.split('?')
  const id = new URLSearchParams(search).get('id')
  return id && id.trim() ? id.trim().toUpperCase() : null
}

function compare(a: AssetRow, b: AssetRow, key: SortKey) {
  if (key === 'recent') {
    return (b.last_seen ?? '').localeCompare(a.last_seen ?? '') || b.units - a.units
  }
  if (key === 'open') {
    return b.open_claims - a.open_claims || b.units - a.units
  }
  return b.units - a.units || classRank(a.asset_class) - classRank(b.asset_class)
}

function AssetIndexList({ rows, state, onOpen, total }: {
  rows: AssetRow[]
  state: LoadState
  total: number
  onOpen: (asset: string) => void
}) {
  if (state === 'loading') {
    return <div className="asset-list-loading" aria-label="正在读取标的">{[0, 1, 2, 3, 4].map((key) => <i key={key} />)}</div>
  }
  if (state === 'error') {
    return <p className="asset-empty">标的索引暂时不可用。知识库本身没有受影响，可稍后重试。</p>
  }
  if (rows.length === 0) {
    return <p className="asset-empty">没有匹配的标的。全库当前 {total} 个标的有知识沉淀。</p>
  }
  return (
    <ol className="asset-list">
      {rows.map((row) => {
        const small = row.scored > 0 && row.scored < SMALL_SAMPLE
        return (
          <li key={row.asset}>
            <button onClick={() => onOpen(row.asset)} type="button">
              <span className="asset-list-name">
                <strong>{row.display ?? row.asset}</strong>
                <em>{row.asset}</em>
                <i>{row.class_label ?? '未分类'}</i>
              </span>
              <span className="asset-list-units"><b>{row.units}</b><i>单元</i></span>
              <span className="asset-list-open" data-live={row.open_claims > 0 ? 'true' : undefined}>
                <b>{row.open_claims || '—'}</b><i>未到期</i>
              </span>
              <span className="asset-list-record" data-small={small ? 'true' : undefined}>
                <b>{row.scored === 0 ? '未验证' : percent(row.hit_rate)}</b>
                <i>{row.scored === 0 ? '无到期样本' : `n=${row.scored}`}</i>
              </span>
              <span className="asset-list-seen"><b>{formatDate(row.last_seen)}</b><i>最近提及</i></span>
              <span className="asset-list-coverage" aria-hidden="true">
                <i data-ok={row.bars ? 'true' : 'false'} title="日线" />
                <i data-ok={row.has_metrics ? 'true' : 'false'} title="全维度指标" />
                <i data-ok={row.news ? 'true' : 'false'} title="重要动态" />
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function AssetPage() {
  const [selected, setSelected] = useState<string | null>(() => readAssetFromHash())
  const [index, setIndex] = useState<AssetIndex | null>(null)
  const [indexState, setIndexState] = useState<LoadState>('loading')
  const [dossier, setDossier] = useState<AssetDossierData | null>(null)
  const [dossierState, setDossierState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [assetClass, setAssetClass] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('units')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const update = () => setSelected(readAssetFromHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setIndexState('loading')
    apiJson<AssetIndex>('/asset', { signal: controller.signal }, isAssetIndex)
      .then((payload) => { setIndex(payload); setIndexState('loaded') })
      .catch(() => { if (!controller.signal.aborted) setIndexState('error') })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    if (!selected) {
      setDossier(null)
      return
    }
    const controller = new AbortController()
    setDossierState('loading')
    setDossier(null)
    apiJson<AssetDossierData>(`/asset/${encodeURIComponent(selected)}`, { signal: controller.signal }, isAssetDossier)
      .then((payload) => { setDossier(payload); setDossierState('loaded') })
      .catch(() => { if (!controller.signal.aborted) setDossierState('error') })
    return () => controller.abort()
  }, [selected, reload])

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
  }, [selected])

  const rows = useMemo(() => {
    const all = index?.assets ?? []
    const normalized = query.trim().toLocaleLowerCase()
    return all
      .filter((row) => {
        if (assetClass && row.asset_class !== assetClass) return false
        if (!normalized) return true
        return `${row.asset} ${row.display ?? ''} ${row.class_label ?? ''}`.toLocaleLowerCase().includes(normalized)
      })
      .sort((left, right) => compare(left, right, sort))
  }, [assetClass, index, query, sort])

  const classes = useMemo(() => {
    const counts = new Map<string, number>()
    ;(index?.assets ?? []).forEach((row) => {
      if (row.asset_class) counts.set(row.asset_class, (counts.get(row.asset_class) ?? 0) + 1)
    })
    return [...counts.entries()].sort((left, right) => classRank(left[0]) - classRank(right[0]))
  }, [index])

  const totals = useMemo(() => {
    const all = index?.assets ?? []
    return {
      assets: all.length,
      open: all.reduce((sum, row) => sum + row.open_claims, 0),
      scored: all.reduce((sum, row) => sum + row.scored, 0),
    }
  }, [index])

  const openAsset = (asset: string) => { window.location.hash = `#/asset?id=${encodeURIComponent(asset)}` }
  const backToIndex = () => { window.location.hash = '#/asset' }

  if (selected) {
    const position = rows.findIndex((row) => row.asset === selected)
    const previous = position > 0 ? rows[position - 1] : null
    const next = position >= 0 && position < rows.length - 1 ? rows[position + 1] : null
    return (
      <div className="asset-page asset-page-detail">
        <div aria-hidden="true" className="asset-material" />
        <header className="asset-detail-nav">
          <button onClick={backToIndex} type="button"><span aria-hidden="true">←</span><b>返回标的列表</b></button>
          <div><span>FANISL / ASSET DESK</span><b>{selected}</b></div>
          <nav aria-label="相邻标的">
            <button disabled={!previous} onClick={() => previous && openAsset(previous.asset)} type="button">上一个</button>
            <span>{position >= 0 ? `${position + 1} / ${rows.length}` : '— / —'}</span>
            <button disabled={!next} onClick={() => next && openAsset(next.asset)} type="button">下一个</button>
          </nav>
        </header>
        <main className="asset-detail-stage">
          {dossierState === 'loading' && <p className="asset-empty">正在读取 {selected} 的档案…</p>}
          {dossierState === 'error' && (
            <div className="asset-empty asset-empty-page">
              <p>读不到 {selected} 的档案。它可能不是一个已知标的，也可能后端暂时不可用。</p>
              <button onClick={() => setReload((value) => value + 1)} type="button">重试</button>
              <button onClick={backToIndex} type="button">回到标的列表</button>
            </div>
          )}
          {dossierState === 'loaded' && dossier && <AssetDossier dossier={dossier} onOpenAsset={openAsset} />}
        </main>
      </div>
    )
  }

  return (
    <div className="asset-page">
      <div aria-hidden="true" className="asset-material" />
      <AppHeader current="asset" onSearch={() => { window.location.hash = '#/knowledge?search=1' }} />
      <main className="asset-stage">
        <header className="asset-masthead">
          <div className="asset-title">
            <span>ASSET DESK</span>
            <h1>标的</h1>
            <p><i />按资产标的读同一批证据</p>
          </div>
          <div className="asset-statement">
            <span>WHAT IT ANSWERS</span>
            <strong>我要对这个标的做决策，库里关于它有什么？</strong>
            <p>
              先看还有什么判断没兑现、判据是什么、哪天到期；再看谁在这个标的上说得准；
              最后看他们在哪里对立、谁改过口。每一块都能两次点击回到逐字原文与冻结判据。
            </p>
          </div>
          <dl className="asset-scale">
            <div><dt>有沉淀的标的</dt><dd>{indexState === 'loading' ? '—' : totals.assets}</dd></div>
            <div><dt>等待到期的判断</dt><dd>{indexState === 'loading' ? '—' : totals.open}</dd></div>
            <div><dt>已判定时点</dt><dd>{indexState === 'loading' ? '—' : totals.scored}</dd></div>
          </dl>
        </header>

        <section className="asset-index" aria-label="标的索引">
          <div className="asset-tools">
            <label>
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="检索标的"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="标的代码或名称"
                value={query}
              />
            </label>
            <div className="asset-sort" role="group" aria-label="排序">
              {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                <button aria-pressed={sort === key} key={key} onClick={() => setSort(key)} type="button">
                  {sortLabels[key]}
                </button>
              ))}
            </div>
          </div>
          <div className="asset-classes" role="group" aria-label="按类别过滤">
            <button aria-pressed={assetClass === null} onClick={() => setAssetClass(null)} type="button">
              全部<i>{totals.assets}</i>
            </button>
            {classes.map(([key, count]) => (
              <button
                aria-pressed={assetClass === key}
                key={key}
                onClick={() => setAssetClass(assetClass === key ? null : key)}
                type="button"
              >
                {index?.classes[key] ?? key}<i>{count}</i>
              </button>
            ))}
          </div>
          <AssetIndexList onOpen={openAsset} rows={rows} state={indexState} total={totals.assets} />
          {indexState === 'error' && (
            <button className="asset-retry" onClick={() => setReload((value) => value + 1)} type="button">重新读取</button>
          )}
        </section>

        <footer className="asset-footer">
          <span>FANISL / ASSET DESK</span>
          <p>
            覆盖是不均匀的：日线覆盖大部分标的，全维度指标与重要动态当前只覆盖 5 个加密对，
            公司资料尚未接入。每份档案的「数据覆盖」都写明缺什么、为什么缺。
          </p>
        </footer>
      </main>
    </div>
  )
}

export default AssetPage
