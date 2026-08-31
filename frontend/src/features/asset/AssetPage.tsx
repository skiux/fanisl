import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import { isAssetDossier, isAssetIndex } from '../../shared/api/contracts'
import AppHeader from '../../shared/navigation/AppHeader'
import AssetDossier, { DOSSIER_VIEWS, type DossierView } from './AssetDossier'
import AssetRail, { type SortKey } from './AssetRail'
import DeskOverview from './DeskOverview'
import { classRank } from './format'
import type { AssetDossierData, AssetIndex, AssetRow } from './types'
import './asset.css'

type LoadState = 'loading' | 'loaded' | 'error'

function readRoute() {
  const [, search = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(search)
  const id = params.get('id')
  const view = params.get('view')
  return {
    asset: id && id.trim() ? id.trim().toUpperCase() : null,
    // **没写 view 就是"没指定"**，不是"要看未到期"——由档案自己落到第一个有内容的分节。
    // 37% 的标的一条未到期判断都没有，恒定落在那一节等于点开就是空的。
    view: (DOSSIER_VIEWS as string[]).includes(view ?? '') ? view as DossierView : null,
  }
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

function AssetPage() {
  const [route, setRoute] = useState(() => readRoute())
  const selected = route.asset
  const [index, setIndex] = useState<AssetIndex | null>(null)
  const [indexState, setIndexState] = useState<LoadState>('loading')
  const [dossier, setDossier] = useState<AssetDossierData | null>(null)
  const [dossierState, setDossierState] = useState<LoadState>('loading')
  const [query, setQuery] = useState('')
  const [assetClass, setAssetClass] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('units')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const update = () => setRoute(readRoute())
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

  const openAsset = (asset: string) => { window.location.hash = `#/asset?id=${encodeURIComponent(asset)}` }
  const selectView = (view: DossierView) => {
    if (selected) window.location.hash = `#/asset?id=${encodeURIComponent(selected)}&view=${view}`
  }
  const backToDesk = () => { window.location.hash = '#/asset' }

  const position = selected ? rows.findIndex((row) => row.asset === selected) : -1
  const previous = position > 0 ? rows[position - 1] : null
  const next = position >= 0 && position < rows.length - 1 ? rows[position + 1] : null

  return (
    <div className="asset-page" data-mode={selected ? 'asset' : 'desk'}>
      <div aria-hidden="true" className="asset-material" />
      <AppHeader current="asset" onSearch={() => { window.location.hash = '#/knowledge?search=1' }} />

      <div className="asset-desk">
        <AssetRail
          assetClass={assetClass}
          index={index}
          onClass={setAssetClass}
          onOpen={openAsset}
          onQuery={setQuery}
          onSort={setSort}
          rows={rows}
          selected={selected}
          sort={sort}
          state={indexState}
          query={query}
        />

        <main className="asset-main">
          {!selected && <DeskOverview onOpenAsset={openAsset} />}

          {selected && (
            <>
              <div className="asset-main-bar">
                <button className="asset-back" onClick={backToDesk} type="button">
                  <span aria-hidden="true">←</span><b>工作台首页</b>
                </button>
                <nav aria-label="相邻标的">
                  <button disabled={!previous} onClick={() => previous && openAsset(previous.asset)} type="button">上一个</button>
                  <span>{position >= 0 ? `${position + 1} / ${rows.length}` : '— / —'}</span>
                  <button disabled={!next} onClick={() => next && openAsset(next.asset)} type="button">下一个</button>
                </nav>
              </div>

              {dossierState === 'loading' && <p className="asset-empty">正在读取 {selected} 的档案…</p>}
              {dossierState === 'error' && (
                <div className="asset-empty asset-empty-page">
                  <p>读不到 {selected} 的档案。它可能不是一个已知标的，也可能后端暂时不可用。</p>
                  <button onClick={() => setReload((value) => value + 1)} type="button">重试</button>
                  <button onClick={backToDesk} type="button">回到工作台首页</button>
                </div>
              )}
              {dossierState === 'loaded' && dossier && (
                <AssetDossier
                  dossier={dossier}
                  onOpenAsset={openAsset}
                  onSelectView={selectView}
                  view={route.view}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default AssetPage
